import { useEffect, useRef, useState, useCallback, useMemo, memo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Heart, LogOut, Send, ImagePlus, X, Check, CheckCheck, Reply, CornerDownRight, Download, Mic, Play, Pause, Wifi, WifiOff, Paperclip, FileText, Film, Eye, EyeOff, Bell, BellOff } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { toast } from "@/hooks/use-toast";


const URL_REGEX = /(https?:\/\/[^\s<]+)/g;
const URL_TEST = /^https?:\/\//;
const TYPING_THROTTLE_MS = 1800;
const MESSAGE_UPDATE_BATCH_MS = 80;
const IDLE_AFTER_MS = 5 * 60 * 1000; // 5 min of no activity → idle (Discord-like)

type PresenceStatus = "online" | "idle" | "offline";

const STATUS_META: Record<PresenceStatus, { label: string; dot: string; ring: string; text: string }> = {
  online: {
    label: "Online",
    dot: "bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.85)]",
    ring: "ring-background",
    text: "text-green-500",
  },
  idle: {
    label: "Idle",
    dot: "bg-yellow-400 shadow-[0_0_6px_rgba(250,204,21,0.85)]",
    ring: "ring-background",
    text: "text-yellow-500",
  },
  offline: {
    label: "Offline",
    dot: "bg-muted-foreground/50",
    ring: "ring-background",
    text: "text-muted-foreground",
  },
};

const areStringSetsEqual = (a: Set<string>, b: Set<string>) => {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
};

const areMessagesEqual = (a: Message, b: Message) =>
  a.id === b.id &&
  a.sender_id === b.sender_id &&
  a.content === b.content &&
  a.created_at === b.created_at &&
  a.image_url === b.image_url &&
  a.audio_url === b.audio_url &&
  a.read_at === b.read_at &&
  a.reply_to_id === b.reply_to_id &&
  a.file_url === b.file_url &&
  a.file_name === b.file_name &&
  a.file_type === b.file_type &&
  a.video_url === b.video_url;

const areMessageListsEqual = (a: Message[], b: Message[]) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!areMessagesEqual(a[i], b[i])) return false;
  return true;
};

const MessageContent = memo(function MessageContent({ text }: { text: string }) {
  const parts = text.split(URL_REGEX);
  return (
    <p className="text-sm leading-relaxed break-words">
      {parts.map((part, i) =>
        URL_TEST.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline break-all"
            onClick={(e) => e.stopPropagation()}
          >
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </p>
  );
});

function AudioPlayer({ src }: { src: string }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current?.remove();
      audioRef.current = null;
    };
  }, [src]);

  const toggle = () => {
    if (!audioRef.current) {
      const audio = new Audio(src);
      audio.preload = "metadata";
      audioRef.current = audio;
      audio.addEventListener("loadedmetadata", () => setDuration(audio.duration));
      audio.addEventListener("timeupdate", () => setProgress(audio.currentTime));
      audio.addEventListener("ended", () => { setPlaying(false); setProgress(0); });
    }
    if (playing) { audioRef.current.pause(); } else { audioRef.current.play(); }
    setPlaying(!playing);
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex items-center gap-2 min-w-[160px]">
      <button onClick={toggle} className="shrink-0 p-1 rounded-full hover:bg-muted/50">
        {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </button>
      <div className="flex-1 flex flex-col gap-0.5">
        <div className="h-1 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all"
            style={{ width: `${duration ? (progress / duration) * 100 : 0}%` }}
          />
        </div>
        <span className="text-[10px] text-muted-foreground">{formatTime(progress)}/{formatTime(duration)}</span>
      </div>
    </div>
  );
}

interface Message {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
  image_url: string | null;
  audio_url: string | null;
  read_at: string | null;
  reply_to_id: string | null;
  file_url?: string | null;
  file_name?: string | null;
  file_type?: string | null;
  video_url?: string | null;
}

interface ProfileData {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  last_seen?: string | null;
  show_presence?: boolean;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

type ProfileUpdate = Partial<ProfileData> & { user_id: string };
type MessageInsert = Omit<Message, "id" | "created_at" | "read_at"> & {
  read_at?: string | null;
};

export default function ChatPage() {
  const { user, signOut } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileData>>({});
  const [newMsg, setNewMsg] = useState("");
  const [sending, setSending] = useState(false);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedVideo, setSelectedVideo] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const partnerTypingRef = useRef(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | "unsupported">(
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported",
  );
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [presenceMap, setPresenceMap] = useState<Record<string, PresenceStatus>>({});
  const [myStatus, setMyStatus] = useState<PresenceStatus>("online");
  const myStatusRef = useRef<PresenceStatus>("online");
  const presenceChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const [, setNowTick] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const markedReadRef = useRef<Set<string>>(new Set());
  const lastTypingSentRef = useRef(0);
  const pendingMessageUpdatesRef = useRef<Map<string, Message>>(new Map());
  const messageUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [visibleCount, setVisibleCount] = useState(120);
  const profilesRef = useRef<Record<string, ProfileData>>({});
  const userIdRef = useRef<string | undefined>(user?.id);

  useEffect(() => {
    profilesRef.current = profiles;
  }, [profiles]);

  useEffect(() => {
    userIdRef.current = user?.id;
  }, [user?.id]);

  // Online/offline detection
  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // Tick every 30s so "last seen X ago" stays fresh
  useEffect(() => {
    const t = setInterval(() => setNowTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const myShowPresence = user ? (profiles[user.id]?.show_presence ?? true) : true;

  // Presence tracking — Discord-like: each user broadcasts status (online/idle).
  // Skipped when the user has hidden their presence.
  useEffect(() => {
    if (!user) return;
    if (!myShowPresence) {
      presenceChannelRef.current = null;
      return;
    }
    const channel = supabase.channel("presence-room", {
      config: { presence: { key: user.id } },
    });
    presenceChannelRef.current = channel;

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState() as Record<string, Array<{ status?: PresenceStatus }>>;
        const next: Record<string, PresenceStatus> = {};
        for (const uid of Object.keys(state)) {
          // Take the most "online" status across that user's sessions
          let best: PresenceStatus = "idle";
          for (const meta of state[uid]) {
            if (meta?.status === "online") { best = "online"; break; }
          }
          next[uid] = best;
        }
        setPresenceMap((prev) => {
          const prevKeys = Object.keys(prev);
          const nextKeys = Object.keys(next);
          if (prevKeys.length === nextKeys.length && nextKeys.every((k) => prev[k] === next[k])) return prev;
          return next;
        });
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ status: myStatusRef.current, online_at: new Date().toISOString() });
        }
      });

    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      presenceChannelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [user, myShowPresence]);

  // Re-broadcast my status whenever it changes
  useEffect(() => {
    myStatusRef.current = myStatus;
    const ch = presenceChannelRef.current;
    if (ch) {
      ch.track({ status: myStatus, online_at: new Date().toISOString() }).catch(() => {});
    }
  }, [myStatus]);

  // Activity & idle detection — online while tab is visible AND user interacted recently
  useEffect(() => {
    if (!user) return;
    const bump = () => {
      lastActivityRef.current = Date.now();
      if (document.visibilityState === "visible" && myStatusRef.current !== "online") {
        setMyStatus("online");
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        setMyStatus("idle");
      } else {
        lastActivityRef.current = Date.now();
        setMyStatus("online");
      }
    };
    const events: (keyof WindowEventMap)[] = ["pointerdown", "keydown", "mousemove", "touchstart", "focus", "scroll"];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    document.addEventListener("visibilitychange", onVisibility);

    const interval = setInterval(() => {
      const inactive = Date.now() - lastActivityRef.current;
      if (document.visibilityState === "hidden" || inactive >= IDLE_AFTER_MS) {
        if (myStatusRef.current !== "idle") setMyStatus("idle");
      } else if (myStatusRef.current !== "online") {
        setMyStatus("online");
      }
    }, 30000);

    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(interval);
    };
  }, [user]);

  // PWA install prompt
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);

    if (window.matchMedia("(display-mode: standalone)").matches) {
      setIsInstalled(true);
    }

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") {
        setIsInstalled(true);
      }
      setDeferredPrompt(null);
    } else {
      toast({
        title: "Install Us Only 💕",
        description: "On iPhone: tap Share → Add to Home Screen. On Android: tap ⋮ menu → Install app.",
      });
    }
  };

  // Keep notification permission state fresh (e.g. user changes it in browser settings)
  useEffect(() => {
    if (!("Notification" in window)) return;
    const sync = () => setNotifPermission(Notification.permission);
    sync();
    const onVis = () => sync();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, []);

  const isIOS = useMemo(
    () =>
      typeof navigator !== "undefined" &&
      (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && (navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints! > 1)),
    [],
  );
  const isStandalone = useMemo(
    () =>
      typeof window !== "undefined" &&
      (window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as Navigator & { standalone?: boolean }).standalone === true),
    [isInstalled],
  );

  const toggleNotifications = useCallback(async () => {
    if (!("Notification" in window)) {
      toast({
        title: "Notifications not supported",
        description: isIOS
          ? "On iPhone, first tap Share → Add to Home Screen, then open the app from your home screen and try again."
          : "Your browser doesn't support notifications.",
        variant: "destructive",
      });
      return;
    }
    if (isIOS && !isStandalone) {
      toast({
        title: "Install Us Only first 💕",
        description: "iPhone needs the app on your Home Screen for notifications. Tap Share → Add to Home Screen, then open it from there.",
      });
      return;
    }
    if (Notification.permission === "granted") {
      // Show a quick test so she knows it's working
      try {
        new Notification("Notifications are on 💕", { body: "You'll get pinged when a new message arrives.", icon: "/icon-192.png" });
      } catch { /* ignore */ }
      toast({ title: "Already enabled", description: "You're all set to receive message notifications." });
      return;
    }
    if (Notification.permission === "denied") {
      toast({
        title: "Notifications blocked",
        description: "Open browser settings for this site and allow Notifications, then come back.",
        variant: "destructive",
      });
      return;
    }
    try {
      const res = await Notification.requestPermission();
      setNotifPermission(res);
      if (res === "granted") {
        try {
          new Notification("Notifications enabled 💕", { body: "You'll get pinged for new messages.", icon: "/icon-192.png" });
        } catch { /* ignore */ }
        toast({ title: "Notifications on ✨", description: "You'll be notified when a new message arrives." });
      } else {
        toast({ title: "Permission not granted", description: "You can enable it anytime from this button.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Could not enable", description: "Try again or check your browser settings.", variant: "destructive" });
    }
  }, [isIOS, isStandalone, toast]);

  const playPing = useCallback((ringtone = false) => {
    try {
      const ctx = new AudioContext();
      // Warm crystal-glass chime: ascending perfect 4ths with shimmer + delay tail
      const master = ctx.createGain();
      master.gain.value = ringtone ? 0.9 : 0.75;

      // Gentle low-pass to remove harshness
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 6000;
      lp.Q.value = 0.7;

      // Feedback delay for a "room/reverb" tail
      const delay = ctx.createDelay(1.0);
      delay.delayTime.value = 0.18;
      const fb = ctx.createGain();
      fb.gain.value = 0.28;
      const wet = ctx.createGain();
      wet.gain.value = 0.35;
      delay.connect(fb).connect(delay);
      delay.connect(wet).connect(ctx.destination);

      master.connect(lp);
      lp.connect(ctx.destination);
      lp.connect(delay);

      // Mellow notes: C5 → G5 → C6 (warmer than the old E6/A6/C#7)
      const notes = [
        { f: 523.25, t: 0.0 },
        { f: 783.99, t: 0.13 },
        { f: 1046.5, t: 0.26 },
      ];

      const repeats = ringtone ? 3 : 1;
      const cycleLen = 1.1;

      const playNote = (f: number, start: number) => {
        // Fundamental sine
        const o1 = ctx.createOscillator();
        o1.type = "sine";
        o1.frequency.value = f;
        // Octave shimmer
        const o2 = ctx.createOscillator();
        o2.type = "sine";
        o2.frequency.value = f * 2.01; // slight detune for life
        // Sub for warmth
        const o3 = ctx.createOscillator();
        o3.type = "triangle";
        o3.frequency.value = f / 2;

        const g1 = ctx.createGain();
        g1.gain.setValueAtTime(0.0001, start);
        g1.gain.exponentialRampToValueAtTime(0.7, start + 0.015);
        g1.gain.exponentialRampToValueAtTime(0.0005, start + 0.9);

        const g2 = ctx.createGain();
        g2.gain.setValueAtTime(0.0001, start);
        g2.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
        g2.gain.exponentialRampToValueAtTime(0.0005, start + 0.7);

        const g3 = ctx.createGain();
        g3.gain.setValueAtTime(0.0001, start);
        g3.gain.exponentialRampToValueAtTime(0.22, start + 0.03);
        g3.gain.exponentialRampToValueAtTime(0.0005, start + 0.8);

        o1.connect(g1).connect(master);
        o2.connect(g2).connect(master);
        o3.connect(g3).connect(master);
        o1.start(start); o2.start(start); o3.start(start);
        o1.stop(start + 1.0); o2.stop(start + 0.9); o3.stop(start + 0.95);
      };

      for (let r = 0; r < repeats; r++) {
        const offset = r * cycleLen;
        notes.forEach((n) => playNote(n.f, ctx.currentTime + n.t + offset));
      }

      const totalMs = Math.ceil((repeats * cycleLen + 1.4) * 1000);
      setTimeout(() => ctx.close(), totalMs);

      // Vibrate on mobile for extra discoverability
      if ("vibrate" in navigator) {
        navigator.vibrate?.(ringtone ? [80, 60, 80, 60, 160] : [40, 30, 60]);
      }
    } catch {
      return;
    }
  }, []);

  const notifyNewMessage = useCallback((msg: Message) => {
    const inactive = document.hidden || !document.hasFocus();
    playPing(inactive);
    if ("Notification" in window && Notification.permission === "granted" && inactive) {
      const senderName = profilesRef.current[msg.sender_id]?.display_name || "Your Love";
      const body = msg.image_url && !msg.content ? "📷 Sent a photo" : (msg.content || "New message");
      try {
        const n = new Notification(`${senderName} 💕`, {
          body,
          tag: "soul-chat-message",
          icon: "/favicon.ico",
          ...({ renotify: true, badge: "/favicon.ico" } as object),
        });
        n.onclick = () => {
          window.focus();
          n.close();
        };
      } catch {
        // ignore
      }
    }
  }, [playPing]);

  useEffect(() => {
    supabase
      .from("profiles")
      .select("user_id, display_name, avatar_url, last_seen, show_presence")
      .then(({ data }) => {
        if (data) {
          const map: Record<string, ProfileData> = {};
          (data as ProfileData[]).forEach((p) => (map[p.user_id] = {
            user_id: p.user_id,
            display_name: p.display_name,
            avatar_url: p.avatar_url,
            last_seen: p.last_seen,
            show_presence: p.show_presence ?? true,
          }));
          setProfiles(map);
        }
      });
  }, []);

  // Update own last_seen periodically while tab is active, and on unload.
  // Skipped entirely when the user has hidden their presence.
  useEffect(() => {
    if (!user) return;
    if (!myShowPresence) return;
    const ping = () => {
      supabase.from("profiles").update({ last_seen: new Date().toISOString() } as ProfileUpdate).eq("user_id", user.id).then();
    };
    ping();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") ping();
    }, 30000);
    const onHide = () => ping();
    window.addEventListener("beforeunload", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      clearInterval(interval);
      window.removeEventListener("beforeunload", onHide);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [user, myShowPresence]);

  // Subscribe to profile updates so we see partner's last_seen change in realtime
  useEffect(() => {
    const channel = supabase
      .channel("profiles-realtime")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles" },
        (payload) => {
          const p = payload.new as ProfileData;
          const nextProfile: ProfileData = {
            user_id: p.user_id,
            display_name: p.display_name,
            avatar_url: p.avatar_url,
            last_seen: p.last_seen,
            show_presence: p.show_presence ?? true,
          };
          setProfiles((prev) => {
            const current = prev[p.user_id];
            if (p.user_id === user?.id && current?.last_seen !== nextProfile.last_seen) return prev;
            if (
              current &&
              current.display_name === nextProfile.display_name &&
              current.avatar_url === nextProfile.avatar_url &&
              current.last_seen === nextProfile.last_seen &&
              current.show_presence === nextProfile.show_presence
            ) {
              return prev;
            }
            return { ...prev, [p.user_id]: nextProfile };
          });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id]);

  const fetchMessages = useCallback(async () => {
    const { data } = await supabase
      .from("messages")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (data) {
      const nextMessages = data.reverse() as Message[];
      setMessages((prev) => (areMessageListsEqual(prev, nextMessages) ? prev : nextMessages));
    }
  }, []);

  // Fetch messages and subscribe to realtime
  useEffect(() => {
    fetchMessages();

    const flushMessageUpdates = () => {
      const updates = pendingMessageUpdatesRef.current;
      if (updates.size === 0) return;
      pendingMessageUpdatesRef.current = new Map();
      messageUpdateTimerRef.current = null;
      setMessages((prev) => {
        let changed = false;
        const next = prev.map((m) => {
          const update = updates.get(m.id);
          if (!update || areMessagesEqual(m, update)) return m;
          changed = true;
          return update;
        });
        return changed ? next : prev;
      });
    };

    const queueMessageUpdate = (message: Message) => {
      pendingMessageUpdatesRef.current.set(message.id, message);
      if (messageUpdateTimerRef.current) return;
      messageUpdateTimerRef.current = setTimeout(flushMessageUpdates, MESSAGE_UPDATE_BATCH_MS);
    };

    const channel = supabase
      .channel("messages-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const newMsg = payload.new as Message;
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
          if (newMsg.sender_id !== user?.id) {
            notifyNewMessage(newMsg);
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages" },
        (payload) => {
          queueMessageUpdate(payload.new as Message);
        }
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") {
          setTimeout(() => {
            supabase.removeChannel(channel);
            fetchMessages();
          }, 2000);
        }
      });

    return () => {
      if (messageUpdateTimerRef.current) clearTimeout(messageUpdateTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, [fetchMessages, notifyNewMessage, user?.id]);

  // Refetch when tab regains focus (realtime covers the rest — no heartbeat needed)
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") fetchMessages();
    };
    window.addEventListener("focus", fetchMessages);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", fetchMessages);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchMessages]);

  // Typing indicator channel
  useEffect(() => {
    if (!user) return;
    const channel = supabase.channel("typing-indicators");
    typingChannelRef.current = channel;

    channel
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        if (payload.user_id !== user.id) {
          if (!partnerTypingRef.current) {
            partnerTypingRef.current = true;
            setPartnerTyping(true);
          }
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = setTimeout(() => {
            partnerTypingRef.current = false;
            setPartnerTyping(false);
          }, 2000);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const broadcastTyping = () => {
    const now = Date.now();
    // Throttle: at most one broadcast every few keystrokes
    if (now - lastTypingSentRef.current < TYPING_THROTTLE_MS) return;
    lastTypingSentRef.current = now;
    typingChannelRef.current?.send({
      type: "broadcast",
      event: "typing",
      payload: { user_id: user?.id },
    });
  };

  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      const threshold = 80;
      isAtBottomRef.current =
        el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    };
    el.addEventListener("scroll", onScroll);
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (isAtBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "auto" });
    }
  }, [messages, partnerTyping]);

  useEffect(() => {
    setVisibleCount((count) => Math.min(Math.max(count, 120), messages.length || 120));
  }, [messages.length]);

  // Mark unread messages from partner as read — only when the chat is actually visible
  useEffect(() => {
    if (!user) return;

    const markVisible = () => {
      if (document.visibilityState !== "visible" || !document.hasFocus()) return;
      const ids: string[] = [];
      for (const m of messages) {
        if (m.sender_id !== user.id && !m.read_at && !markedReadRef.current.has(m.id)) {
          ids.push(m.id);
          markedReadRef.current.add(m.id);
        }
      }
      if (ids.length === 0) return;
      supabase
        .from("messages")
        .update({ read_at: new Date().toISOString() })
        .in("id", ids)
        .then();
    };

    markVisible();
    window.addEventListener("focus", markVisible);
    document.addEventListener("visibilitychange", markVisible);
    return () => {
      window.removeEventListener("focus", markVisible);
      document.removeEventListener("visibilitychange", markVisible);
    };
  }, [messages, user]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedImage(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const clearImage = () => {
    setSelectedImage(null);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const clearFile = () => {
    setSelectedFile(null);
    if (docInputRef.current) docInputRef.current.value = "";
  };

  const clearVideo = () => {
    setSelectedVideo(null);
    if (videoPreview) URL.revokeObjectURL(videoPreview);
    setVideoPreview(null);
    if (videoInputRef.current) videoInputRef.current.value = "";
  };

  const handleDocSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      toast({ title: "File too large", description: "Max 50MB per file." });
      return;
    }
    setSelectedFile(file);
  };

  const handleVideoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      toast({ title: "Video too large", description: "Max 50MB per video." });
      return;
    }
    setSelectedVideo(file);
    setVideoPreview(URL.createObjectURL(file));
  };

  const downloadUrl = async (url: string, filename: string) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } catch {
      window.open(url, "_blank");
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
        setRecordingDuration(0);

        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        if (blob.size === 0 || !user) return;

        setSending(true);
        const path = `${user.id}/${Date.now()}.webm`;
        const { error } = await supabase.storage.from("voice-messages").upload(path, blob);
        if (!error) {
          const { data: urlData } = supabase.storage.from("voice-messages").getPublicUrl(path);
          const voiceMessage: MessageInsert = {
            sender_id: user.id,
            content: "",
            image_url: null,
            audio_url: urlData.publicUrl,
            reply_to_id: replyTo?.id || null,
          };
          await supabase.from("messages").insert(voiceMessage);
          setReplyTo(null);
        }
        setSending(false);
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingDuration(0);
      recordingIntervalRef.current = setInterval(() => setRecordingDuration((d) => d + 1), 1000);
    } catch {
      toast({ title: "Microphone access denied", description: "Please allow microphone access to send voice messages." });
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
    }
    if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
    setIsRecording(false);
    setRecordingDuration(0);
    audioChunksRef.current = [];
  };

  const handleReply = (msg: Message) => {
    setReplyTo(msg);
    inputRef.current?.focus();
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!newMsg.trim() && !selectedImage && !selectedFile && !selectedVideo) || !user) return;
    setSending(true);

    const msgContent = newMsg.trim();
    const replyId = replyTo?.id || null;

    // Clear input immediately for snappy UX
    setNewMsg("");
    setReplyTo(null);

    let image_url: string | null = null;
    let file_url: string | null = null;
    let file_name: string | null = null;
    let file_type: string | null = null;
    let video_url: string | null = null;

    if (selectedImage) {
      const ext = selectedImage.name.split(".").pop();
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from("chat-images")
        .upload(path, selectedImage);
      if (!error) {
        const { data: urlData } = supabase.storage
          .from("chat-images")
          .getPublicUrl(path);
        image_url = urlData.publicUrl;
      }
    }

    if (selectedVideo) {
      const ext = selectedVideo.name.split(".").pop();
      const path = `${user.id}/${Date.now()}-vid.${ext}`;
      const { error } = await supabase.storage.from("chat-files").upload(path, selectedVideo, { contentType: selectedVideo.type });
      if (!error) {
        video_url = supabase.storage.from("chat-files").getPublicUrl(path).data.publicUrl;
      }
    }

    if (selectedFile) {
      const safeName = selectedFile.name.replace(/[^\w.-]/g, "_");
      const path = `${user.id}/${Date.now()}-${safeName}`;
      const { error } = await supabase.storage.from("chat-files").upload(path, selectedFile, { contentType: selectedFile.type });
      if (!error) {
        file_url = supabase.storage.from("chat-files").getPublicUrl(path).data.publicUrl;
        file_name = selectedFile.name;
        file_type = selectedFile.type || "application/octet-stream";
      }
    }

    clearImage();
    clearFile();
    clearVideo();

    // Retry up to 3 times on failure
    let attempts = 0;
    let success = false;
    const outgoingMessage: MessageInsert = {
      sender_id: user.id,
      content: msgContent,
      image_url,
      audio_url: null,
      reply_to_id: replyId,
      file_url,
      file_name,
      file_type,
      video_url,
    };
    while (attempts < 3 && !success) {
      const { error } = await supabase.from("messages").insert(outgoingMessage);
      if (!error) {
        success = true;
      } else {
        attempts++;
        if (attempts < 3) await new Promise((r) => setTimeout(r, 1000 * attempts));
      }
    }

    if (!success) {
      toast({ title: "Message failed to send", description: "Please check your connection and try again." });
      setNewMsg(msgContent); // Restore message so user doesn't lose it
    }

    setSending(false);
  };

  const isMine = (msg: Message) => msg.sender_id === user?.id;

  const messagesById = useMemo(() => {
    const m = new Map<string, Message>();
    for (const msg of messages) m.set(msg.id, msg);
    return m;
  }, [messages]);

  const partner = useMemo(
    () => Object.values(profiles).find((p) => p.user_id !== user?.id) || null,
    [profiles, user?.id]
  );
  const partnerPresenceVisible = partner?.show_presence !== false;
  const partnerStatus: PresenceStatus = partner && partnerPresenceVisible
    ? (presenceMap[partner.user_id] ?? "offline")
    : "offline";
  const partnerOnline = partnerStatus === "online";
  const partnerMeta = STATUS_META[partnerStatus];

  const togglePresencePrivacy = useCallback(async () => {
    if (!user) return;
    const next = !myShowPresence;
    setProfiles((prev) => ({
      ...prev,
      [user.id]: { ...(prev[user.id] || { user_id: user.id, display_name: "", avatar_url: null }), show_presence: next },
    }));
    const { error } = await supabase
      .from("profiles")
      .update({ show_presence: next } as ProfileUpdate)
      .eq("user_id", user.id);
    if (error) {
      toast({ title: "Couldn't update privacy", description: error.message, variant: "destructive" });
      // revert
      setProfiles((prev) => ({
        ...prev,
        [user.id]: { ...(prev[user.id] || { user_id: user.id, display_name: "", avatar_url: null }), show_presence: !next },
      }));
    } else {
      toast({
        title: next ? "Status visible" : "Status hidden",
        description: next
          ? "Your partner can see when you're online and your last seen."
          : "Your online status and last seen are hidden from your partner.",
      });
    }
  }, [user, myShowPresence]);
  const visibleMessages = useMemo(
    () => messages.slice(Math.max(0, messages.length - visibleCount)),
    [messages, visibleCount]
  );
  const hasHiddenMessages = visibleCount < messages.length;

  const renderedMessages = useMemo(() => {
    return visibleMessages.map((msg) => {
      const mine = msg.sender_id === user?.id;
      const repliedMsg = msg.reply_to_id ? messagesById.get(msg.reply_to_id) || null : null;
      return (
        <div
          key={msg.id}
          id={`msg-${msg.id}`}
          className={`group flex ${mine ? "justify-end" : "justify-start"} rounded-2xl`}
        >
          <div className="flex items-end gap-1.5">
            {!mine && (
              <div className="relative shrink-0">
                <Avatar className="w-7 h-7 ring-2 ring-background">
                  <AvatarImage src={profiles[msg.sender_id]?.avatar_url || undefined} />
                  <AvatarFallback className="text-[10px] bg-gradient-to-br from-primary/40 to-accent/40 text-primary-foreground">
                    {(profiles[msg.sender_id]?.display_name || "L").charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                {(() => {
                  if (profiles[msg.sender_id]?.show_presence === false) return null;
                  const s = presenceMap[msg.sender_id];
                  if (!s || s === "offline") return null;
                  return (
                    <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-background ${STATUS_META[s].dot}`} />
                  );
                })()}
              </div>
            )}
            {mine && (
              <button
                onClick={() => handleReply(msg)}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-full hover:bg-muted"
              >
                <Reply className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            )}
            <div
              className={`max-w-[78vw] sm:max-w-[60%] md:max-w-[55%] rounded-2xl px-3 sm:px-4 py-2 sm:py-2.5 shadow-sm ${
                mine
                  ? "bg-gradient-to-br from-primary/90 to-accent/80 text-primary-foreground rounded-br-sm shadow-primary/20"
                  : "bg-chat-theirs/80 rounded-bl-sm border border-border/40"
              }`}
            >
              {!mine && (
                <p className="text-xs text-primary font-medium mb-0.5">
                  {profiles[msg.sender_id]?.display_name || "Love"}
                </p>
              )}
              {repliedMsg && (
                <button
                  onClick={() => scrollToMessage(repliedMsg.id)}
                  className={`w-full text-left mb-1.5 px-3 py-1.5 rounded-lg border-l-2 border-primary/60 text-xs ${
                    mine ? "bg-primary/10" : "bg-muted/50"
                  }`}
                >
                  <p className="text-primary/80 font-medium truncate text-[10px]">
                    {profiles[repliedMsg.sender_id]?.display_name || "Love"}
                  </p>
                  <p className="text-muted-foreground line-clamp-2 break-words whitespace-pre-wrap text-[11px] leading-snug">
                    {repliedMsg.image_url && !repliedMsg.content ? "📷 Photo" : repliedMsg.content}
                  </p>
                </button>
              )}
              {msg.image_url && (
                <img
                  src={msg.image_url}
                  alt="Shared photo"
                  loading="lazy"
                  decoding="async"
                  className="rounded-lg max-w-full max-h-60 object-cover cursor-pointer mb-1"
                  onClick={() => setLightboxUrl(msg.image_url)}
                />
              )}
              {msg.video_url && (
                <div className="mb-1 relative group/vid">
                  <video src={msg.video_url} controls preload="metadata" className="rounded-lg max-w-full max-h-60" />
                  <button
                    type="button"
                    onClick={() => downloadUrl(msg.video_url!, `video-${msg.id}.mp4`)}
                    className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white opacity-0 group-hover/vid:opacity-100 transition-opacity"
                    title="Download"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              {msg.file_url && (
                <button
                  type="button"
                  onClick={() => downloadUrl(msg.file_url!, msg.file_name || "file")}
                  className="mb-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-background/40 hover:bg-background/60 transition-colors w-full text-left"
                >
                  <FileText className="w-5 h-5 shrink-0 text-primary" />
                  <span className="text-xs flex-1 truncate">{msg.file_name || "File"}</span>
                  <Download className="w-4 h-4 shrink-0 opacity-70" />
                </button>
              )}
              {msg.audio_url && <AudioPlayer src={msg.audio_url} />}
              {msg.content && <MessageContent text={msg.content} />}
              <div className="flex items-center justify-end gap-1 mt-1">
                <p className={`text-[10px] ${mine ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                  {format(new Date(msg.created_at), "h:mm a")}
                </p>
                {mine && (
                  msg.read_at
                    ? <CheckCheck className="w-4 h-4 text-sky-300 drop-shadow-[0_0_2px_rgba(0,0,0,0.4)]" />
                    : (partnerOnline
                        ? <CheckCheck className="w-4 h-4 text-primary-foreground/80" />
                        : <Check className="w-4 h-4 text-primary-foreground/80" />)
                )}
              </div>
            </div>
            {!mine && (
              <button
                onClick={() => handleReply(msg)}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-full hover:bg-muted"
              >
                <Reply className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            )}
            {mine && (
              <div className="relative shrink-0">
                <Avatar className="w-7 h-7 ring-2 ring-background">
                  <AvatarImage src={profiles[msg.sender_id]?.avatar_url || undefined} />
                  <AvatarFallback className="text-[10px] bg-gradient-to-br from-primary to-accent text-primary-foreground">
                    {(profiles[msg.sender_id]?.display_name || "M").charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-500 ring-2 ring-background" />
              </div>
            )}
          </div>
        </div>
      );
    });
  }, [visibleMessages, messagesById, profiles, presenceMap, partnerOnline, user?.id]);

  const scrollToMessage = (msgId: string) => {
    const el = document.getElementById(`msg-${msgId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-primary/50");
      setTimeout(() => el.classList.remove("ring-2", "ring-primary/50"), 1500);
    }
  };

  return (
    <div className="relative flex flex-col h-[100dvh] w-full max-w-3xl mx-auto">
      {/* Header */}
      <header className="flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5 sm:py-3 border-b border-border/60 bg-card/70 backdrop-blur-xl supports-[backdrop-filter]:bg-card/50 sticky top-0 z-20">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          <div className="relative shrink-0">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg shadow-primary/30">
              <Heart className="w-4 h-4 text-primary-foreground" fill="currentColor" />
            </div>
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-semibold text-sm sm:text-base bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              Us Only
            </span>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              {(() => {
                if (!partner) {
                  return (
                    <span className="flex items-center gap-1">
                      {isOnline ? <Wifi className="w-3 h-3 text-green-500" /> : <WifiOff className="w-3 h-3 text-destructive" />}
                      {isOnline ? "Connected" : "Offline"}
                    </span>
                  );
                }
                if (!partnerPresenceVisible) {
                  return (
                    <span className="flex items-center gap-1.5 truncate" title="Your partner has hidden their status">
                      <EyeOff className="w-3 h-3 text-muted-foreground" />
                      <span className="truncate">
                        <span className="font-medium text-foreground/80">{partner.display_name}</span>
                        <span className="ml-1 text-muted-foreground">· Status hidden</span>
                      </span>
                    </span>
                  );
                }
                const lastSeenDate = partner.last_seen ? new Date(partner.last_seen) : null;
                const statusText =
                  partnerStatus === "online"
                    ? "Online"
                    : partnerStatus === "idle"
                      ? (lastSeenDate ? `Idle · last active ${formatDistanceToNow(lastSeenDate, { addSuffix: true })}` : "Idle")
                      : lastSeenDate
                        ? `Last seen ${formatDistanceToNow(lastSeenDate, { addSuffix: true })}`
                        : "Offline";
                return (
                  <span
                    className="flex items-center gap-1.5 truncate"
                    title={lastSeenDate ? `Last active ${format(lastSeenDate, "PPp")}` : undefined}
                  >
                    <span className={`w-2 h-2 rounded-full ${partnerMeta.dot}`} />
                    <span className="truncate">
                      <span className="font-medium text-foreground/80">{partner.display_name}</span>
                      <span className={`ml-1 ${partnerMeta.text}`}>· {statusText}</span>
                    </span>
                  </span>
                );
              })()}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className={`hidden sm:flex items-center gap-1 text-[10px] px-2 py-1 rounded-full ${isOnline ? 'bg-green-500/15 text-green-500' : 'bg-destructive/15 text-destructive'}`}>
            {isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {isOnline ? 'Online' : 'Offline'}
          </span>
          {!isInstalled && (
            <Button variant="ghost" size="icon" onClick={handleInstall} title="Install app">
              <Download className="w-4 h-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={togglePresencePrivacy}
            title={myShowPresence ? "Hide my online status & last seen" : "Show my online status & last seen"}
            aria-label="Toggle presence privacy"
          >
            {myShowPresence
              ? <Eye className="w-4 h-4" />
              : <EyeOff className="w-4 h-4 text-yellow-500" />}
          </Button>
          <Button variant="ghost" size="icon" onClick={signOut}>
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </header>

      {/* Messages */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-2 sm:px-4 py-3 sm:py-4 space-y-2.5 sm:space-y-3 scrollbar-hide overscroll-contain">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm">
            <Heart className="w-10 h-10 mb-2 text-primary/30" />
            <p>No messages yet. Say hi! 💕</p>
          </div>
        )}
        {hasHiddenMessages && (
          <div className="flex justify-center py-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setVisibleCount((count) => Math.min(messages.length, count + 120))}
              className="h-8 text-xs"
            >
              Load older messages
            </Button>
          </div>
        )}
        {renderedMessages}
        {partnerTyping && (
          <div className="flex justify-start">
            <div className="bg-chat-theirs rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:0ms]" />
              <span className="w-2 h-2 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:150ms]" />
              <span className="w-2 h-2 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Reply preview */}
      {replyTo && (
        <div className="px-4 py-2 border-t border-border bg-card flex items-center gap-2">
          <CornerDownRight className="w-4 h-4 text-primary shrink-0" />
          <div className="flex-1 min-w-0 text-xs">
            <p className="text-primary font-medium">
              {isMine(replyTo) ? "You" : profiles[replyTo.sender_id]?.display_name || "Love"}
            </p>
            <p className="text-muted-foreground line-clamp-2 break-words whitespace-pre-wrap leading-snug">
              {replyTo.image_url && !replyTo.content ? "📷 Photo" : replyTo.content}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setReplyTo(null)} className="shrink-0 h-6 w-6">
            <X className="w-3 h-3" />
          </Button>
        </div>
      )}

      {/* Image preview */}
      {imagePreview && (
        <div className="px-4 py-2 border-t border-border bg-card flex items-center gap-2">
          <img src={imagePreview} alt="Preview" className="h-16 w-16 rounded-lg object-cover" />
          <Button variant="ghost" size="icon" onClick={clearImage} className="shrink-0">
            <X className="w-4 h-4" />
          </Button>
        </div>
      )}

      {/* Video preview */}
      {videoPreview && (
        <div className="px-4 py-2 border-t border-border bg-card flex items-center gap-2">
          <video src={videoPreview} className="h-16 w-16 rounded-lg object-cover" />
          <span className="text-xs flex-1 truncate">{selectedVideo?.name}</span>
          <Button variant="ghost" size="icon" onClick={clearVideo} className="shrink-0">
            <X className="w-4 h-4" />
          </Button>
        </div>
      )}

      {/* File preview */}
      {selectedFile && (
        <div className="px-4 py-2 border-t border-border bg-card flex items-center gap-2">
          <FileText className="w-6 h-6 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs truncate">{selectedFile.name}</p>
            <p className="text-[10px] text-muted-foreground">{(selectedFile.size / 1024).toFixed(1)} KB</p>
          </div>
          <Button variant="ghost" size="icon" onClick={clearFile} className="shrink-0">
            <X className="w-4 h-4" />
          </Button>
        </div>
      )}

      {/* Recording indicator */}
      {isRecording && (
        <div className="px-4 py-2 border-t border-border bg-card flex items-center gap-3">
          <span className="w-2.5 h-2.5 rounded-full bg-destructive animate-pulse" />
          <span className="text-sm text-destructive font-medium flex-1">
            Recording... {Math.floor(recordingDuration / 60)}:{(recordingDuration % 60).toString().padStart(2, "0")}
          </span>
          <Button variant="ghost" size="icon" onClick={cancelRecording} className="shrink-0 h-8 w-8">
            <X className="w-4 h-4" />
          </Button>
          <Button size="icon" onClick={stopRecording} className="shrink-0 h-8 w-8">
            <Send className="w-4 h-4" />
          </Button>
        </div>
      )}

      {/* Input */}
      {!isRecording && (
        <form
          onSubmit={handleSend}
          className="flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-2 sm:py-3 border-t border-border bg-card"
        >
          <input
            type="file"
            accept="image/*"
            ref={fileInputRef}
            onChange={handleImageSelect}
            className="hidden"
          />
          <input
            type="file"
            accept="video/*"
            ref={videoInputRef}
            onChange={handleVideoSelect}
            className="hidden"
          />
          <input
            type="file"
            ref={docInputRef}
            onChange={handleDocSelect}
            className="hidden"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => fileInputRef.current?.click()}
            className="shrink-0"
          >
            <ImagePlus className="w-4 h-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => videoInputRef.current?.click()}
            className="shrink-0"
            title="Send video"
          >
            <Film className="w-4 h-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => docInputRef.current?.click()}
            className="shrink-0"
            title="Send file"
          >
            <Paperclip className="w-4 h-4" />
          </Button>
          <Input
            ref={inputRef}
            value={newMsg}
            onChange={(e) => {
              setNewMsg(e.target.value);
              if (e.target.value.trim()) broadcastTyping();
            }}
            onPaste={(e) => {
              const items = e.clipboardData?.items;
              if (!items) return;
              for (const item of Array.from(items)) {
                if (item.type.startsWith("image/")) {
                  e.preventDefault();
                  const file = item.getAsFile();
                  if (file) {
                    setSelectedImage(file);
                    setImagePreview(URL.createObjectURL(file));
                  }
                  break;
                }
              }
            }}
            placeholder="Type a message..."
            className="flex-1 bg-secondary border-border"
            autoFocus
          />
          {newMsg.trim() || selectedImage || selectedFile || selectedVideo ? (
            <Button
              type="submit"
              size="icon"
              disabled={sending}
              className="shrink-0"
            >
              <Send className="w-4 h-4" />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={startRecording}
              className="shrink-0"
            >
              <Mic className="w-4 h-4" />
            </Button>
          )}
        </form>
      )}

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            onClick={() => setLightboxUrl(null)}
            className="absolute top-3 right-3 text-white/80 hover:text-white z-10"
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={lightboxUrl}
            alt="Full size"
            className="max-w-full max-h-full object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

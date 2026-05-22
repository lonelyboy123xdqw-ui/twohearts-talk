import { useEffect, useRef, useState, useCallback, useMemo, memo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Heart, LogOut, Send, ImagePlus, X, Check, CheckCheck, Reply, CornerDownRight, Download, Mic, Square, Play, Pause, Wifi, WifiOff, Paperclip, FileText, Film } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { toast } from "@/hooks/use-toast";


const URL_REGEX = /(https?:\/\/[^\s<]+)/g;
const URL_TEST = /^https?:\/\//;
const TYPING_THROTTLE_MS = 1800;
const MESSAGE_UPDATE_BATCH_MS = 80;

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
}

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
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
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

  // Presence tracking — broadcasts which users are currently connected
  useEffect(() => {
    if (!user) return;
    const channel = supabase.channel("presence-room", {
      config: { presence: { key: user.id } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        setOnlineUsers(new Set(Object.keys(state)));
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ online_at: new Date().toISOString() });
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  // PWA install prompt
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
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

  // Request notification permission
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  const playPing = () => {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
      setTimeout(() => ctx.close(), 500);
    } catch {}
  };

  const notifyNewMessage = (msg: Message) => {
    playPing();
    if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
      const senderName = profiles[msg.sender_id]?.display_name || "Your Love";
      const body = msg.image_url && !msg.content ? "📷 Sent a photo" : msg.content;
      new Notification(`${senderName} 💕`, { body });
    }
  };

  useEffect(() => {
    supabase
      .from("profiles")
      .select("user_id, display_name, avatar_url, last_seen")
      .then(({ data }) => {
        if (data) {
          const map: Record<string, ProfileData> = {};
          data.forEach((p: any) => (map[p.user_id] = { user_id: p.user_id, display_name: p.display_name, avatar_url: p.avatar_url, last_seen: p.last_seen }));
          setProfiles(map);
        }
      });
  }, []);

  // Update own last_seen periodically while tab is active, and on unload
  useEffect(() => {
    if (!user) return;
    const ping = () => {
      supabase.from("profiles").update({ last_seen: new Date().toISOString() } as any).eq("user_id", user.id).then();
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
  }, [user]);

  // Subscribe to profile updates so we see partner's last_seen change in realtime
  useEffect(() => {
    const channel = supabase
      .channel("profiles-realtime")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles" },
        (payload) => {
          const p = payload.new as any;
          setProfiles((prev) => ({
            ...prev,
            [p.user_id]: { user_id: p.user_id, display_name: p.display_name, avatar_url: p.avatar_url, last_seen: p.last_seen },
          }));
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const fetchMessages = useCallback(async () => {
    const { data } = await supabase
      .from("messages")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (data) setMessages(data.reverse());
  }, []);

  // Fetch messages and subscribe to realtime
  useEffect(() => {
    fetchMessages();

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
          setMessages((prev) =>
            prev.map((m) => (m.id === (payload.new as Message).id ? (payload.new as Message) : m))
          );
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
      supabase.removeChannel(channel);
    };
  }, []);

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
          setPartnerTyping(true);
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = setTimeout(() => setPartnerTyping(false), 2000);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const broadcastTyping = () => {
    const now = Date.now();
    // Throttle: at most one broadcast per 1.2s
    if (now - lastTypingSentRef.current < 1200) return;
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
          await supabase.from("messages").insert({
            sender_id: user.id,
            content: "",
            audio_url: urlData.publicUrl,
            reply_to_id: replyTo?.id || null,
          } as any);
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
      const safeName = selectedFile.name.replace(/[^\w.\-]/g, "_");
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
    while (attempts < 3 && !success) {
      const { error } = await supabase.from("messages").insert({
        sender_id: user.id,
        content: msgContent,
        image_url,
        reply_to_id: replyId,
        file_url,
        file_name,
        file_type,
        video_url,
      } as any);
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
  const partnerOnline = partner ? onlineUsers.has(partner.user_id) : false;

  const renderedMessages = useMemo(() => {
    return messages.map((msg) => {
      const mine = msg.sender_id === user?.id;
      const repliedMsg = msg.reply_to_id ? messagesById.get(msg.reply_to_id) || null : null;
      return (
        <div
          key={msg.id}
          id={`msg-${msg.id}`}
          className={`group flex ${mine ? "justify-end" : "justify-start"} transition-all duration-300 rounded-2xl`}
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
                {onlineUsers.has(msg.sender_id) && (
                  <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-500 ring-2 ring-background" />
                )}
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
              className={`max-w-[78vw] sm:max-w-[60%] md:max-w-[55%] rounded-2xl px-3 sm:px-4 py-2 sm:py-2.5 shadow-md backdrop-blur-sm ${
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
                  <p className="text-muted-foreground truncate">
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, messagesById, profiles, onlineUsers, partnerOnline, user?.id]);

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
                return (
                  <span className="flex items-center gap-1.5 truncate">
                    <span className={`w-1.5 h-1.5 rounded-full ${partnerOnline ? "bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.8)]" : "bg-muted-foreground/50"}`} />
                    <span className="truncate">
                      {partner.display_name} · {partnerOnline
                        ? "online"
                        : partner.last_seen
                          ? `last seen ${formatDistanceToNow(new Date(partner.last_seen), { addSuffix: true })}`
                          : "offline"}
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
          <Button variant="ghost" size="icon" onClick={signOut}>
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </header>

      {/* Messages */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-2 sm:px-4 py-3 sm:py-4 space-y-2.5 sm:space-y-3 scrollbar-hide">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm">
            <Heart className="w-10 h-10 mb-2 text-primary/30" />
            <p>No messages yet. Say hi! 💕</p>
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
            <p className="text-muted-foreground truncate">
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

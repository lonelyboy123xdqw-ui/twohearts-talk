import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Heart, LogOut, Send, ImagePlus, X, Check, CheckCheck, Reply, CornerDownRight, Download, Mic, Square, Play, Pause } from "lucide-react";
import { format } from "date-fns";
import { toast } from "@/hooks/use-toast";
import { Dialog, DialogContent } from "@/components/ui/dialog";

const URL_REGEX = /(https?:\/\/[^\s<]+)/g;

function MessageContent({ text }: { text: string }) {
  const parts = text.split(URL_REGEX);
  return (
    <p className="text-sm leading-relaxed break-words">
      {parts.map((part, i) =>
        URL_REGEX.test(part) ? (
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
}

function AudioPlayer({ src }: { src: string }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = new Audio(src);
    audioRef.current = audio;
    audio.addEventListener("loadedmetadata", () => setDuration(audio.duration));
    audio.addEventListener("timeupdate", () => setProgress(audio.currentTime));
    audio.addEventListener("ended", () => { setPlaying(false); setProgress(0); });
    return () => { audio.pause(); audio.remove(); };
  }, [src]);

  const toggle = () => {
    if (!audioRef.current) return;
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
}

interface Profile {
  user_id: string;
  display_name: string;
}

export default function ChatPage() {
  const { user, signOut } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [newMsg, setNewMsg] = useState("");
  const [sending, setSending] = useState(false);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

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
      const senderName = profiles[msg.sender_id] || "Your Love";
      const body = msg.image_url && !msg.content ? "📷 Sent a photo" : msg.content;
      new Notification(`${senderName} 💕`, { body });
    }
  };

  useEffect(() => {
    supabase
      .from("profiles")
      .select("user_id, display_name")
      .then(({ data }) => {
        if (data) {
          const map: Record<string, string> = {};
          data.forEach((p: Profile) => (map[p.user_id] = p.display_name));
          setProfiles(map);
        }
      });
  }, []);

  // Fetch messages and subscribe to realtime
  useEffect(() => {
    supabase
      .from("messages")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10000)
      .then(({ data }) => {
        if (data) setMessages(data.reverse());
      });

    const channel = supabase
      .channel("messages-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const newMsg = payload.new as Message;
          setMessages((prev) => [...prev, newMsg]);
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
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

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
    typingChannelRef.current?.send({
      type: "broadcast",
      event: "typing",
      payload: { user_id: user?.id },
    });
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, partnerTyping]);

  // Mark unread messages from partner as read
  useEffect(() => {
    if (!user) return;
    const unread = messages.filter((m) => m.sender_id !== user.id && !m.read_at);
    if (unread.length === 0) return;
    const ids = unread.map((m) => m.id);
    supabase
      .from("messages")
      .update({ read_at: new Date().toISOString() })
      .in("id", ids)
      .then();
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

  const handleReply = (msg: Message) => {
    setReplyTo(msg);
    inputRef.current?.focus();
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!newMsg.trim() && !selectedImage) || !user) return;
    setSending(true);

    let image_url: string | null = null;

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

    await supabase.from("messages").insert({
      sender_id: user.id,
      content: newMsg.trim(),
      image_url,
      reply_to_id: replyTo?.id || null,
    });
    setNewMsg("");
    clearImage();
    setReplyTo(null);
    setSending(false);
  };

  const isMine = (msg: Message) => msg.sender_id === user?.id;

  const getRepliedMessage = (replyId: string | null) => {
    if (!replyId) return null;
    return messages.find((m) => m.id === replyId) || null;
  };

  const scrollToMessage = (msgId: string) => {
    const el = document.getElementById(`msg-${msgId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-primary/50");
      setTimeout(() => el.classList.remove("ring-2", "ring-primary/50"), 1500);
    }
  };

  return (
    <div className="flex flex-col h-screen max-w-lg mx-auto">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-2">
          <Heart className="w-5 h-5 text-primary" fill="currentColor" />
          <span className="font-semibold text-lg">Us Only</span>
        </div>
        <div className="flex items-center gap-1">
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
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 scrollbar-hide">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm">
            <Heart className="w-10 h-10 mb-2 text-primary/30" />
            <p>No messages yet. Say hi! 💕</p>
          </div>
        )}
        {messages.map((msg) => {
          const repliedMsg = getRepliedMessage(msg.reply_to_id);
          return (
            <div
              key={msg.id}
              id={`msg-${msg.id}`}
              className={`group flex ${isMine(msg) ? "justify-end" : "justify-start"} transition-all duration-300 rounded-2xl`}
            >
              <div className="flex items-center gap-1">
                {/* Reply button - left side for own messages */}
                {isMine(msg) && (
                  <button
                    onClick={() => handleReply(msg)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-full hover:bg-muted"
                  >
                    <Reply className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                )}
                <div
                  className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
                    isMine(msg)
                      ? "bg-chat-mine rounded-br-sm"
                      : "bg-chat-theirs rounded-bl-sm"
                  }`}
                >
                  {!isMine(msg) && (
                    <p className="text-xs text-primary font-medium mb-0.5">
                      {profiles[msg.sender_id] || "Love"}
                    </p>
                  )}
                  {/* Replied message preview */}
                  {repliedMsg && (
                    <button
                      onClick={() => scrollToMessage(repliedMsg.id)}
                      className={`w-full text-left mb-1.5 px-3 py-1.5 rounded-lg border-l-2 border-primary/60 text-xs ${
                        isMine(msg) ? "bg-primary/10" : "bg-muted/50"
                      }`}
                    >
                      <p className="text-primary/80 font-medium truncate text-[10px]">
                        {profiles[repliedMsg.sender_id] || "Love"}
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
                      className="rounded-lg max-w-full max-h-60 object-cover cursor-pointer mb-1"
                      onClick={() => setLightboxUrl(msg.image_url)}
                    />
                  )}
                  {msg.content && <MessageContent text={msg.content} />}
                  <div className="flex items-center justify-end gap-1 mt-1">
                    <p className="text-[10px] text-muted-foreground">
                      {format(new Date(msg.created_at), "h:mm a")}
                    </p>
                    {isMine(msg) && (
                      msg.read_at
                        ? <CheckCheck className="w-3.5 h-3.5 text-primary" />
                        : <Check className="w-3.5 h-3.5 text-muted-foreground" />
                    )}
                  </div>
                </div>
                {/* Reply button - right side for partner messages */}
                {!isMine(msg) && (
                  <button
                    onClick={() => handleReply(msg)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-full hover:bg-muted"
                  >
                    <Reply className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
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
              {isMine(replyTo) ? "You" : profiles[replyTo.sender_id] || "Love"}
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

      {/* Input */}
      <form
        onSubmit={handleSend}
        className="flex items-center gap-2 px-4 py-3 border-t border-border bg-card"
      >
        <input
          type="file"
          accept="image/*"
          ref={fileInputRef}
          onChange={handleImageSelect}
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
        <Button
          type="submit"
          size="icon"
          disabled={(!newMsg.trim() && !selectedImage) || sending}
          className="shrink-0"
        >
          <Send className="w-4 h-4" />
        </Button>
      </form>

      {/* Lightbox */}
      <Dialog open={!!lightboxUrl} onOpenChange={() => setLightboxUrl(null)}>
        <DialogContent className="max-w-[90vw] max-h-[90vh] p-2 bg-background/95">
          {lightboxUrl && (
            <img src={lightboxUrl} alt="Full size" className="w-full h-full object-contain rounded-lg" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

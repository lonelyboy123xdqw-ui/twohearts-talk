import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Heart, LogOut, Send, ImagePlus, X } from "lucide-react";
import { format } from "date-fns";
import { Dialog, DialogContent } from "@/components/ui/dialog";

interface Message {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
  image_url: string | null;
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
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Fetch profiles
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
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (data) setMessages(data);
      });

    const channel = supabase
      .channel("messages-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          setMessages((prev) => [...prev, payload.new as Message]);
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
    });
    setNewMsg("");
    clearImage();
    setSending(false);
  };

  const isMine = (msg: Message) => msg.sender_id === user?.id;

  return (
    <div className="flex flex-col h-screen max-w-lg mx-auto">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-2">
          <Heart className="w-5 h-5 text-primary" fill="currentColor" />
          <span className="font-semibold text-lg">Us Only</span>
        </div>
        <Button variant="ghost" size="icon" onClick={signOut}>
          <LogOut className="w-4 h-4" />
        </Button>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 scrollbar-hide">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm">
            <Heart className="w-10 h-10 mb-2 text-primary/30" />
            <p>No messages yet. Say hi! 💕</p>
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${isMine(msg) ? "justify-end" : "justify-start"}`}
          >
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
              {msg.image_url && (
                <img
                  src={msg.image_url}
                  alt="Shared photo"
                  className="rounded-lg max-w-full max-h-60 object-cover cursor-pointer mb-1"
                  onClick={() => setLightboxUrl(msg.image_url)}
                />
              )}
              {msg.content && (
                <p className="text-sm leading-relaxed break-words">{msg.content}</p>
              )}
              <p className="text-[10px] text-muted-foreground mt-1 text-right">
                {format(new Date(msg.created_at), "h:mm a")}
              </p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

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
          value={newMsg}
          onChange={(e) => setNewMsg(e.target.value)}
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

import { useEffect, useState } from "react";
import { Sparkles, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const WHATS_NEW_VERSION = "2026-08-14";
const KEY = "whats_new_seen_version";

const ITEMS: { emoji: string; title: string; body: string }[] = [
  { emoji: "📱", title: "Super smooth on iPhone", body: "Safe-area layout, keyboard-aware composer, momentum scrolling and 60fps animations — no more zooming or jumpy screens." },
  { emoji: "🗑️", title: "Unsend messages", body: "Tap (or hover) your own message and hit the trash icon — it disappears for both of us instantly, media included." },
  { emoji: "🎨", title: "22 chat themes", body: "Palette icon in the header: Twilight, Neon, Galaxy, Vaporwave, Matrix, Sakura, Inferno and more." },
  { emoji: "🖼️", title: "Media never deleted", body: "Photos, videos, voice notes and files now stay forever in the shared media panel." },
  { emoji: "🟢", title: "Live presence & ticks", body: "Online / idle / last-seen status, typing dots, and blue ticks the moment your message is actually read." },
];

export function openWhatsNew() {
  window.dispatchEvent(new CustomEvent("open-whats-new"));
}

export default function WhatsNew() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(KEY) !== WHATS_NEW_VERSION) setOpen(true);
    } catch { /* ignore */ }
    const handler = () => setOpen(true);
    window.addEventListener("open-whats-new", handler);
    return () => window.removeEventListener("open-whats-new", handler);
  }, []);

  const close = () => {
    setOpen(false);
    try { localStorage.setItem(KEY, WHATS_NEW_VERSION); } catch { /* ignore */ }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <DialogContent className="max-w-md max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            What's new 💕
          </DialogTitle>
          <DialogDescription>A few upgrades landed in our little space.</DialogDescription>
        </DialogHeader>

        <ul className="space-y-3">
          {ITEMS.map((i) => (
            <li key={i.title} className="flex gap-3 rounded-xl border border-border/60 bg-card/60 p-3">
              <span className="text-lg leading-none" aria-hidden>{i.emoji}</span>
              <div className="min-w-0">
                <p className="text-sm font-medium">{i.title}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{i.body}</p>
              </div>
            </li>
          ))}
        </ul>

        <DialogFooter>
          <Button onClick={close} className="w-full">
            <Bell className="w-4 h-4 mr-2" /> Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
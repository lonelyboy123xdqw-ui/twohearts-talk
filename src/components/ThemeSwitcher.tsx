import { useEffect, useState } from "react";
import { Palette, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type ChatTheme =
  | "twilight"
  | "neon"
  | "aurora"
  | "classic"
  | "cyberpunk"
  | "sunset"
  | "galaxy"
  | "molten"
  | "vaporwave"
  | "emerald"
  | "bloodmoon"
  | "iridescent"
  | "matrix"
  | "candy"
  | "oceanic"
  | "frostbite"
  | "sakura"
  | "obsidian"
  | "electric"
  | "inferno"
  | "royal"
  | "midnight";

const THEMES: { id: ChatTheme; label: string; hint: string; swatch: string[] }[] = [
  { id: "twilight", label: "Twilight Bloom", hint: "Rose-gold on obsidian plum",
    swatch: ["#2a1235", "#ec3d7a", "#ff9a4d"] },
  { id: "neon", label: "Neon Pulse", hint: "Electric cyan & magenta on jet",
    swatch: ["#05060a", "#22d3ee", "#f472b6"] },
  { id: "aurora", label: "Aurora", hint: "Emerald & violet on midnight",
    swatch: ["#0a1a2f", "#34d399", "#a78bfa"] },
  { id: "classic", label: "Classic", hint: "Warm cream + navy",
    swatch: ["#f5f1e8", "#1e3a5f", "#c94f4f"] },
  { id: "cyberpunk", label: "Cyberpunk 2088", hint: "Hot yellow + hot pink on ink",
    swatch: ["#0a0014", "#f9f871", "#ff2e93"] },
  { id: "sunset", label: "Sunset Blaze", hint: "Molten orange to deep magenta",
    swatch: ["#1a0510", "#ff6a3d", "#ff2975"] },
  { id: "galaxy", label: "Galaxy Drift", hint: "Nebula violet + stardust blue",
    swatch: ["#08061f", "#7c3aed", "#38bdf8"] },
  { id: "molten", label: "Molten Gold", hint: "Liquid gold on charred black",
    swatch: ["#0d0906", "#f5b301", "#ff6b1a"] },
  { id: "vaporwave", label: "Vaporwave", hint: "Pastel pink + cyan chrome",
    swatch: ["#1a0b2e", "#ff71ce", "#01cdfe"] },
  { id: "emerald", label: "Emerald Noir", hint: "Deep jade + champagne",
    swatch: ["#040f0a", "#10b981", "#eab308"] },
  { id: "bloodmoon", label: "Blood Moon", hint: "Crimson + ember on ash",
    swatch: ["#100303", "#dc2626", "#fb923c"] },
  { id: "iridescent", label: "Iridescent", hint: "Holographic prism shift",
    swatch: ["#0a0518", "#c084fc", "#5eead4"] },
  { id: "matrix", label: "Matrix", hint: "Phosphor green on terminal black",
    swatch: ["#000000", "#00ff9c", "#4ade80"] },
  { id: "candy", label: "Candy Dream", hint: "Cotton pink + mint on cream",
    swatch: ["#fff0f7", "#ff5aa1", "#4dd4c8"] },
  { id: "oceanic", label: "Oceanic", hint: "Bioluminescent cyan on abyssal black",
    swatch: ["#020617", "#06b6d4", "#3b82f6"] },
  { id: "frostbite", label: "Frostbite", hint: "Arctic ice + glacial teal",
    swatch: ["#f0f9ff", "#0284c7", "#2dd4bf"] },
  { id: "sakura", label: "Sakura", hint: "Cherry blossom pink + lavender",
    swatch: ["#fdf2f8", "#f472b6", "#a78bfa"] },
  { id: "obsidian", label: "Obsidian", hint: "Brutalist black + amber strike",
    swatch: ["#0a0a0a", "#f59e0b", "#e5e5e5"] },
  { id: "electric", label: "Electric", hint: "Neon lime + hot magenta",
    swatch: ["#120524", "#39ff14", "#ff00ff"] },
  { id: "inferno", label: "Inferno", hint: "Lava red + sulfur yellow",
    swatch: ["#140502", "#ff4500", "#ffd700"] },
  { id: "royal", label: "Royal", hint: "Imperial gold on midnight purple",
    swatch: ["#110b1f", "#f5b301", "#8b5cf6"] },
  { id: "midnight", label: "Midnight", hint: "Silver moonlight on deep navy",
    swatch: ["#080c14", "#93c5fd", "#7c3aed"] },
];

const STORAGE_KEY = "chat_theme";

export function applyStoredTheme() {
  try {
    const t = (localStorage.getItem(STORAGE_KEY) as ChatTheme) || "twilight";
    document.documentElement.dataset.theme = t;
  } catch {
    document.documentElement.dataset.theme = "twilight";
  }
}

export default function ThemeSwitcher() {
  const [theme, setTheme] = useState<ChatTheme>("twilight");

  useEffect(() => {
    try {
      const t = (localStorage.getItem(STORAGE_KEY) as ChatTheme) || "twilight";
      setTheme(t);
      document.documentElement.dataset.theme = t;
    } catch { /* ignore */ }
  }, []);

  const pick = (t: ChatTheme) => {
    setTheme(t);
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem(STORAGE_KEY, t); } catch { /* ignore */ }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" title="Change chat theme" aria-label="Change chat theme">
          <Palette className="w-4 h-4 text-primary" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Chat theme</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {THEMES.map((t) => (
          <DropdownMenuItem
            key={t.id}
            onClick={() => pick(t.id)}
            className="flex items-center gap-2 cursor-pointer"
          >
            <div className="flex gap-0.5">
              {t.swatch.map((c) => (
                <span key={c} className="w-3 h-5 rounded-sm" style={{ background: c }} />
              ))}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{t.label}</div>
              <div className="text-[10px] text-muted-foreground truncate">{t.hint}</div>
            </div>
            {theme === t.id && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
import { useEffect, useRef, useState } from "react";
import { Fingerprint, Delete, ShieldCheck } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { NativeBiometric, BiometryType } from "@capgo/capacitor-native-biometric";

const PIN_KEY = "app_lock_pin_v1";
const PIN_LENGTH = 4;

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Props = { onUnlock: () => void };

export default function LockScreen({ onUnlock }: Props) {
  const [storedHash, setStoredHash] = useState<string | null>(null);
  const [entry, setEntry] = useState("");
  const [confirmEntry, setConfirmEntry] = useState("");
  const [mode, setMode] = useState<"loading" | "setup" | "confirm" | "unlock">("loading");
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false);
  const bioTried = useRef(false);

  useEffect(() => {
    const existing = localStorage.getItem(PIN_KEY);
    setStoredHash(existing);
    setMode(existing ? "unlock" : "setup");
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    NativeBiometric.isAvailable()
      .then((r) => setBioAvailable(!!r.isAvailable && r.biometryType !== BiometryType.NONE))
      .catch(() => setBioAvailable(false));
  }, []);

  const tryBiometric = async () => {
    if (!Capacitor.isNativePlatform() || !bioAvailable) return;
    try {
      await NativeBiometric.verifyIdentity({
        reason: "Unlock Us Only",
        title: "Unlock",
        subtitle: "Use Face ID / Touch ID",
        description: "Authenticate to open the app",
      });
      onUnlock();
    } catch {
      /* user cancelled or failed — fall back to PIN */
    }
  };

  useEffect(() => {
    if (mode === "unlock" && bioAvailable && !bioTried.current) {
      bioTried.current = true;
      tryBiometric();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, bioAvailable]);

  const active = mode === "confirm" ? confirmEntry : entry;
  const setActive = mode === "confirm" ? setConfirmEntry : setEntry;

  const press = (d: string) => {
    setError(null);
    if (active.length >= PIN_LENGTH) return;
    const next = active + d;
    setActive(next);
    if (next.length === PIN_LENGTH) void handleComplete(next);
  };

  const backspace = () => {
    setError(null);
    setActive(active.slice(0, -1));
  };

  const fail = (msg: string) => {
    setError(msg);
    setShake(true);
    setTimeout(() => setShake(false), 400);
  };

  async function handleComplete(value: string) {
    if (mode === "setup") {
      setMode("confirm");
      return;
    }
    if (mode === "confirm") {
      if (value !== entry) {
        fail("Pins don't match");
        setEntry("");
        setConfirmEntry("");
        setMode("setup");
        return;
      }
      const hash = await sha256(value);
      localStorage.setItem(PIN_KEY, hash);
      onUnlock();
      return;
    }
    if (mode === "unlock" && storedHash) {
      const hash = await sha256(value);
      if (hash === storedHash) {
        onUnlock();
      } else {
        fail("Wrong PIN");
        setEntry("");
      }
    }
  }

  const title =
    mode === "setup" ? "Create a PIN" : mode === "confirm" ? "Confirm your PIN" : "Enter your PIN";

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-background/95 backdrop-blur-xl">
      <div className="flex flex-col items-center gap-2 mb-8">
        <div className="w-14 h-14 rounded-2xl bg-primary/15 flex items-center justify-center border border-primary/30">
          <ShieldCheck className="w-7 h-7 text-primary" />
        </div>
        <h1 className="text-xl font-semibold mt-2">Us Only</h1>
        <p className="text-sm text-muted-foreground">{title}</p>
      </div>

      <div className={`flex gap-3 mb-2 ${shake ? "animate-[shake_0.4s_ease-in-out]" : ""}`}>
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <div
            key={i}
            className={`w-4 h-4 rounded-full border-2 transition-all ${
              i < active.length ? "bg-primary border-primary scale-110" : "border-muted-foreground/40"
            }`}
          />
        ))}
      </div>
      <div className="h-5 mb-4 text-xs text-destructive">{error}</div>

      <div className="grid grid-cols-3 gap-3 w-64">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button
            key={d}
            onClick={() => press(d)}
            className="h-16 rounded-2xl bg-card/60 hover:bg-card border border-border/50 text-xl font-medium transition active:scale-95"
          >
            {d}
          </button>
        ))}
        <button
          onClick={tryBiometric}
          disabled={!bioAvailable || mode !== "unlock"}
          className="h-16 rounded-2xl flex items-center justify-center disabled:opacity-30 hover:bg-card/60 transition active:scale-95"
          aria-label="Use biometrics"
        >
          <Fingerprint className="w-6 h-6" />
        </button>
        <button
          onClick={() => press("0")}
          className="h-16 rounded-2xl bg-card/60 hover:bg-card border border-border/50 text-xl font-medium transition active:scale-95"
        >
          0
        </button>
        <button
          onClick={backspace}
          className="h-16 rounded-2xl flex items-center justify-center hover:bg-card/60 transition active:scale-95"
          aria-label="Delete"
        >
          <Delete className="w-6 h-6" />
        </button>
      </div>

      {mode === "unlock" && (
        <button
          onClick={() => {
            if (confirm("Reset PIN? This clears your lock code.")) {
              localStorage.removeItem(PIN_KEY);
              setStoredHash(null);
              setEntry("");
              setMode("setup");
            }
          }}
          className="mt-6 text-xs text-muted-foreground hover:text-foreground"
        >
          Forgot PIN? Reset
        </button>
      )}
    </div>
  );
}
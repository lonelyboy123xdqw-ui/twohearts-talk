import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Delete, Fingerprint } from "lucide-react";

const PIN_KEY = "soul.pinHash.v1";
const UNLOCKED_KEY = "soul.unlocked";
const HIDDEN_AT_KEY = "soul.hiddenAt";
const LOCK_AFTER_BG_MS = 60_000;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 30_000;

// Lightweight obfuscation only — not cryptographic. Spec says btoa minimum.
const hashPin = (pin: string) => btoa(`soul:${pin}:salt`);

type Mode = "enter" | "create" | "confirm";

export default function AppLock({ children }: { children: React.ReactNode }) {
  const [locked, setLocked] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [mode, setMode] = useState<Mode>("enter");
  const [pin, setPin] = useState("");
  const [firstPin, setFirstPin] = useState("");
  const [error, setError] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [lockoutUntil, setLockoutUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [fading, setFading] = useState(false);
  const hasStoredPin = useMemo(() => !!localStorage.getItem(PIN_KEY), [hydrated]);

  // Initial state: decide whether to lock
  useEffect(() => {
    const stored = localStorage.getItem(PIN_KEY);
    const unlocked = sessionStorage.getItem(UNLOCKED_KEY) === "1";
    if (!stored) {
      setMode("create");
      setLocked(true);
    } else if (unlocked) {
      setLocked(false);
    } else {
      setMode("enter");
      setLocked(true);
    }
    setHydrated(true);
  }, []);

  // Re-lock when returning from background after 60s
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        sessionStorage.setItem(HIDDEN_AT_KEY, String(Date.now()));
      } else {
        const hiddenAt = Number(sessionStorage.getItem(HIDDEN_AT_KEY) || 0);
        if (hiddenAt && Date.now() - hiddenAt >= LOCK_AFTER_BG_MS) {
          sessionStorage.removeItem(UNLOCKED_KEY);
          setLocked(true);
          setMode(localStorage.getItem(PIN_KEY) ? "enter" : "create");
          setPin("");
          setFirstPin("");
          setFading(false);
        }
        sessionStorage.removeItem(HIDDEN_AT_KEY);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Lockout countdown tick
  useEffect(() => {
    if (lockoutUntil <= 0) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [lockoutUntil]);

  const isLockedOut = lockoutUntil > now;
  const remaining = Math.max(0, Math.ceil((lockoutUntil - now) / 1000));

  const doUnlock = useCallback(() => {
    sessionStorage.setItem(UNLOCKED_KEY, "1");
    setFading(true);
    setTimeout(() => {
      setLocked(false);
      setFading(false);
      setPin("");
    }, 400);
  }, []);

  const shake = useCallback(() => {
    setError(true);
    setTimeout(() => {
      setError(false);
      setPin("");
    }, 450);
  }, []);

  const submit = useCallback(
    (entered: string) => {
      if (mode === "create") {
        setFirstPin(entered);
        setPin("");
        setMode("confirm");
        return;
      }
      if (mode === "confirm") {
        if (entered === firstPin) {
          localStorage.setItem(PIN_KEY, hashPin(entered));
          doUnlock();
        } else {
          shake();
          setFirstPin("");
          setMode("create");
        }
        return;
      }
      // enter
      const stored = localStorage.getItem(PIN_KEY);
      if (stored && stored === hashPin(entered)) {
        setAttempts(0);
        doUnlock();
      } else {
        const next = attempts + 1;
        setAttempts(next);
        shake();
        if (next >= MAX_ATTEMPTS) {
          setLockoutUntil(Date.now() + LOCKOUT_MS);
          setAttempts(0);
          setNow(Date.now());
        }
      }
    },
    [mode, firstPin, attempts, doUnlock, shake]
  );

  const handleDigit = (d: string) => {
    if (isLockedOut) return;
    if (pin.length >= 6) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 6) {
      setTimeout(() => submit(next), 90);
    }
  };

  const handleBack = () => {
    if (isLockedOut) return;
    setPin((p) => p.slice(0, -1));
  };

  const tryBiometric = async () => {
    if (isLockedOut) return;
    try {
      // Best-effort WebAuthn probe; no registered credential = fall through to PIN.
      // We do not require it; success unlocks.
      if (typeof window === "undefined" || !("PublicKeyCredential" in window)) return;
      const available = await (window as any).PublicKeyCredential
        ?.isUserVerifyingPlatformAuthenticatorAvailable?.();
      if (!available) return;
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);
      await navigator.credentials.get({
        publicKey: {
          challenge,
          timeout: 30_000,
          userVerification: "required",
        },
      });
      doUnlock();
    } catch {
      // user cancelled / no credential — stay on PIN
    }
  };

  const [bioAvailable, setBioAvailable] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !("PublicKeyCredential" in window)) return;
    (window as any).PublicKeyCredential
      ?.isUserVerifyingPlatformAuthenticatorAvailable?.()
      .then((v: boolean) => setBioAvailable(!!v))
      .catch(() => setBioAvailable(false));
  }, []);

  if (!hydrated) return null;
  if (!locked) return <>{children}</>;

  const title =
    mode === "create" ? "Create PIN" : mode === "confirm" ? "Confirm PIN" : "Enter PIN";

  const digits = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

  return (
    <>
      <div style={{ display: "none" }}>{children}</div>
      <div
        className={`fixed inset-0 z-[100] flex items-center justify-center transition-opacity duration-[400ms] ${
          fading ? "opacity-0 pointer-events-none" : "opacity-100"
        }`}
        style={{ background: "#06060f" }}
      >
        {/* Animated orb */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <div
            className="h-[420px] w-[420px] rounded-full blur-3xl"
            style={{
              opacity: 0.15,
              background:
                "radial-gradient(circle, #8b5cf6 0%, #3b82f6 55%, transparent 75%)",
              animation: "applockPulse 6s ease-in-out infinite",
            }}
          />
        </div>

        <div className="relative flex flex-col items-center gap-8 px-6 w-full max-w-xs">
          <div className="flex flex-col items-center gap-2">
            <h1
              className="font-extrabold tracking-tight"
              style={{
                fontSize: "2rem",
                background: "linear-gradient(90deg,#a78bfa,#60a5fa)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              Soul
            </h1>
            <p style={{ color: "#475569", fontSize: "0.9rem" }}>
              {isLockedOut
                ? `Too many attempts — try in ${remaining}s`
                : title === "Enter PIN"
                ? "Your private space"
                : title}
            </p>
          </div>

          {/* PIN dots */}
          <div
            className="flex items-center justify-center gap-3"
            style={{
              animation: error ? "applockShake 0.4s linear" : undefined,
            }}
          >
            {Array.from({ length: 6 }).map((_, i) => {
              const filled = i < pin.length;
              return (
                <span
                  key={i}
                  className="rounded-full transition-colors"
                  style={{
                    width: 10,
                    height: 10,
                    background: error
                      ? "#ef4444"
                      : filled
                      ? "#8b5cf6"
                      : "rgba(255,255,255,0.18)",
                    boxShadow: filled ? "0 0 8px rgba(139,92,246,0.6)" : "none",
                  }}
                />
              );
            })}
          </div>

          {bioAvailable && mode === "enter" && hasStoredPin && (
            <button
              type="button"
              onClick={tryBiometric}
              disabled={isLockedOut}
              className="flex items-center gap-2 text-sm text-slate-300 hover:text-white transition disabled:opacity-40"
            >
              <Fingerprint className="w-4 h-4" />
              Use Face ID / Touch ID
            </button>
          )}

          {/* Keypad */}
          <div className="grid grid-cols-3 gap-3">
            {digits.map((d) => (
              <KeypadButton key={d} onClick={() => handleDigit(d)} disabled={isLockedOut}>
                {d}
              </KeypadButton>
            ))}
            <span />
            <KeypadButton onClick={() => handleDigit("0")} disabled={isLockedOut}>
              0
            </KeypadButton>
            <KeypadButton onClick={handleBack} disabled={isLockedOut} aria-label="Backspace">
              <Delete className="w-5 h-5" />
            </KeypadButton>
          </div>
        </div>

        <style>{`
          @keyframes applockShake {
            0%,100% { transform: translateX(0); }
            20% { transform: translateX(-8px); }
            40% { transform: translateX(8px); }
            60% { transform: translateX(-8px); }
            80% { transform: translateX(8px); }
          }
          @keyframes applockPulse {
            0%,100% { transform: scale(1); opacity: 0.12; }
            50% { transform: scale(1.1); opacity: 0.2; }
          }
        `}</style>
      </div>
    </>
  );
}

function KeypadButton({
  children,
  onClick,
  disabled,
  ...rest
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center rounded-full active:scale-[0.92] transition-transform"
      style={{
        width: 64,
        height: 64,
        background: "rgba(255,255,255,0.05)",
        border: "1px solid rgba(255,255,255,0.08)",
        color: "#f1f5f9",
        fontSize: "1.3rem",
        fontWeight: 600,
        opacity: disabled ? 0.4 : 1,
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        (e.currentTarget as HTMLButtonElement).style.background = "rgba(139,92,246,0.15)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.05)";
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
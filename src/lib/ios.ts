// Small iOS-flavoured helpers: haptics, share sheet, platform checks.

type Pattern = number | number[];

const buzz = (pattern: Pattern) => {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
};

export const haptics = {
  /** light tap — buttons, toggles */
  tap: () => buzz(10),
  /** medium impact — swipe threshold, long press */
  impact: () => buzz(18),
  /** success — message sent */
  success: () => buzz([12, 40, 22]),
  /** warning / destructive */
  warning: () => buzz([28, 50, 28]),
};

export const isIOS = () =>
  typeof navigator !== "undefined" &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && (navigator as unknown as { maxTouchPoints: number }).maxTouchPoints > 1));

export const isStandalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true);

export const canShare = () => typeof navigator !== "undefined" && !!navigator.share;

/** Opens the native iOS share sheet. Falls back to copying the link. */
export async function shareContent(opts: { title?: string; text?: string; url?: string }) {
  try {
    if (navigator.share) {
      await navigator.share(opts);
      return true;
    }
    await navigator.clipboard.writeText(opts.url || opts.text || "");
    return false;
  } catch {
    return false;
  }
}

/** Shares an actual file (photo/video/audio) through the iOS share sheet. */
export async function shareFile(url: string, filename: string) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.canShare?.({ files: [file] }) && navigator.share) {
      await navigator.share({ files: [file] });
      return true;
    }
  } catch {
    /* fall through */
  }
  return shareContent({ url });
}

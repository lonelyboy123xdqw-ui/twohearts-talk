import { memo, useRef, useState, type ReactNode } from "react";
import { CornerDownRight } from "lucide-react";
import { haptics } from "@/lib/ios";

const THRESHOLD = 56;

/**
 * iMessage-style row: swipe right to reply, long-press to open actions.
 */
const SwipeRow = memo(function SwipeRow({
  children,
  onReply,
  onLongPress,
  className = "",
}: {
  children: ReactNode;
  onReply: () => void;
  onLongPress: () => void;
  className?: string;
}) {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const armed = useRef(false);
  const locked = useRef<"h" | "v" | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY };
    locked.current = null;
    armed.current = false;
    clearPress();
    pressTimer.current = setTimeout(() => {
      if (locked.current !== "h") {
        haptics.impact();
        onLongPress();
      }
    }, 480);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (!start.current) return;
    const t = e.touches[0];
    const deltaX = t.clientX - start.current.x;
    const deltaY = t.clientY - start.current.y;
    if (!locked.current) {
      if (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10) {
        locked.current = Math.abs(deltaX) > Math.abs(deltaY) * 1.4 ? "h" : "v";
        if (locked.current) clearPress();
      }
      return;
    }
    if (locked.current !== "h") return;
    const pull = Math.max(0, Math.min(deltaX * 0.6, 90));
    setDx(pull);
    if (pull >= THRESHOLD && !armed.current) {
      armed.current = true;
      haptics.impact();
    } else if (pull < THRESHOLD) {
      armed.current = false;
    }
  };

  const finish = () => {
    clearPress();
    if (armed.current) onReply();
    armed.current = false;
    locked.current = null;
    start.current = null;
    setDx(0);
  };

  return (
    <div className={`relative ${className}`}>
      {dx > 6 && (
        <div
          className="absolute inset-y-0 left-1 flex items-center pointer-events-none"
          style={{ opacity: Math.min(1, dx / THRESHOLD) }}
        >
          <span className="p-1.5 rounded-full bg-primary/20 text-primary">
            <CornerDownRight className="w-4 h-4" />
          </span>
        </div>
      )}
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={finish}
        onTouchCancel={finish}
        onContextMenu={(e) => {
          e.preventDefault();
          onLongPress();
        }}
        style={{
          transform: dx ? `translate3d(${dx}px,0,0)` : undefined,
          transition: dx ? "none" : "transform 180ms cubic-bezier(0.22,1,0.36,1)",
        }}
      >
        {children}
      </div>
    </div>
  );
});

export default SwipeRow;

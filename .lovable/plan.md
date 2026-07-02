# Plan: Better Colors + Unlimited Media Memory

## 1. Visual Refresh (colors + backgrounds)
Update `src/index.css` design tokens for a richer, more distinctive palette (moving away from the current flat dark purple):
- New background: deep midnight navy with a subtle radial gradient (warm rose glow top-left, cool indigo glow bottom-right) applied to `body`.
- Primary: warm rose-gold (`hsl(345 85% 65%)`) with a `--primary-glow` variant.
- Accent: soft aurora teal for online/active states.
- Add semantic tokens: `--gradient-hero`, `--gradient-bubble-sent`, `--gradient-bubble-received`, `--shadow-glow`, `--surface-glass`.
- Update chat bubbles, header, composer, and media panel in `src/components/ChatPage.tsx` to consume the new tokens (sent = rose-gold gradient, received = glass navy, header = translucent gradient bar).
- Update `AuthPage.tsx` heart icon + background to match.
- No layout changes — only color/background/shadow tokens.

## 2. Unlimited Media Memory
Currently a database trigger deletes the oldest 1000 messages when the table hits 9000, and a companion trigger removes their storage files. This also purges shared images/videos/audio/files.

Migration changes:
- Drop the auto-delete trigger and function on the `messages` table so nothing is ever removed automatically.
- Keep the storage-cleanup trigger, but it will now only fire on explicit user deletions (not bulk purges), preserving all shared media forever.
- No frontend changes required for this part.

## Technical details
- Files touched: `src/index.css`, `src/components/ChatPage.tsx`, `src/components/AuthPage.tsx`, one new SQL migration under `supabase/migrations/`.
- SQL: `DROP TRIGGER IF EXISTS ... ON public.messages; DROP FUNCTION IF EXISTS public.auto_delete_old_messages();` (exact names verified from the earlier migration during implementation).
- No schema/data loss for existing messages or media.

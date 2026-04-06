ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_sender_id_fkey;

INSERT INTO public.messages (sender_id, content, created_at)
VALUES (
  '2169cd35-13a8-4783-afcb-7532b968de25',
  '⚠️ System Notice: The app experienced a glitch from 6:38 IST to 8:34 IST. Messages sent during that time were not delivered. Everything is back to normal now — you can talk freely! 💕',
  now()
);
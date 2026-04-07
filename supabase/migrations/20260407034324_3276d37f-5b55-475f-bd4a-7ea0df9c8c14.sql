ALTER TABLE public.messages ADD COLUMN audio_url text DEFAULT NULL;

INSERT INTO storage.buckets (id, name, public) VALUES ('voice-messages', 'voice-messages', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Anyone can upload voice messages" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'voice-messages');
CREATE POLICY "Anyone can read voice messages" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'voice-messages');
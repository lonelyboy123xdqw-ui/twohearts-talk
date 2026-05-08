
-- Add file sharing columns to messages
ALTER TABLE public.messages 
  ADD COLUMN IF NOT EXISTS file_url text,
  ADD COLUMN IF NOT EXISTS file_name text,
  ADD COLUMN IF NOT EXISTS file_type text,
  ADD COLUMN IF NOT EXISTS video_url text;

-- Create chat-files bucket (public)
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-files', 'chat-files', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for chat-files
DO $$ BEGIN
  CREATE POLICY "Anyone can view chat files"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'chat-files');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Authenticated can upload chat files"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'chat-files' AND auth.uid()::text = (storage.foldername(name))[1]);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Authenticated can delete chat files"
    ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'chat-files');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Helper: extract storage path from a public URL of a given bucket
CREATE OR REPLACE FUNCTION public.extract_storage_path(public_url text, bucket text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(
    regexp_replace(public_url, '^.*/storage/v1/object/public/' || bucket || '/', ''),
    public_url
  );
$$;

-- Trigger to delete storage objects when a message row is deleted
CREATE OR REPLACE FUNCTION public.cleanup_message_storage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  p text;
BEGIN
  IF OLD.image_url IS NOT NULL THEN
    p := public.extract_storage_path(OLD.image_url, 'chat-images');
    IF p IS NOT NULL THEN DELETE FROM storage.objects WHERE bucket_id = 'chat-images' AND name = p; END IF;
  END IF;
  IF OLD.audio_url IS NOT NULL THEN
    p := public.extract_storage_path(OLD.audio_url, 'voice-messages');
    IF p IS NOT NULL THEN DELETE FROM storage.objects WHERE bucket_id = 'voice-messages' AND name = p; END IF;
  END IF;
  IF OLD.file_url IS NOT NULL THEN
    p := public.extract_storage_path(OLD.file_url, 'chat-files');
    IF p IS NOT NULL THEN DELETE FROM storage.objects WHERE bucket_id = 'chat-files' AND name = p; END IF;
  END IF;
  IF OLD.video_url IS NOT NULL THEN
    p := public.extract_storage_path(OLD.video_url, 'chat-files');
    IF p IS NOT NULL THEN DELETE FROM storage.objects WHERE bucket_id = 'chat-files' AND name = p; END IF;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_message_storage ON public.messages;
CREATE TRIGGER trg_cleanup_message_storage
AFTER DELETE ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.cleanup_message_storage();

-- Make sure cleanup_old_messages trigger is attached (delete oldest 1000 when >= 9000)
DROP TRIGGER IF EXISTS trg_cleanup_old_messages ON public.messages;
CREATE TRIGGER trg_cleanup_old_messages
AFTER INSERT ON public.messages
FOR EACH STATEMENT EXECUTE FUNCTION public.cleanup_old_messages();

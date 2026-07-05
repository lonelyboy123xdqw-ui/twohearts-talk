
-- Storage: restrict listing/reading of objects to authenticated users only.
-- Public URLs still resolve because the buckets remain public; only the anonymous
-- list/enumerate path via storage.objects is closed.

DROP POLICY IF EXISTS "Anyone can read voice messages" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view chat files" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view chat images" ON storage.objects;
DROP POLICY IF EXISTS "Avatar images are publicly accessible" ON storage.objects;

CREATE POLICY "Authenticated can read voice messages"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'voice-messages');

CREATE POLICY "Authenticated can view chat files"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'chat-files');

CREATE POLICY "Authenticated can view chat images"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'chat-images');

CREATE POLICY "Authenticated can view avatars"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'avatars');

-- Ownership on uploads (chat-images, voice-messages) — path must start with the
-- uploader's user id (already the app's convention).

DROP POLICY IF EXISTS "Authenticated users can upload chat images" ON storage.objects;
CREATE POLICY "Authenticated can upload chat images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'chat-images'
  AND (auth.uid())::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "Anyone can upload voice messages" ON storage.objects;
CREATE POLICY "Authenticated can upload voice messages"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'voice-messages'
  AND (auth.uid())::text = (storage.foldername(name))[1]
);

-- Ownership on deletes — user can only delete their own files.

DROP POLICY IF EXISTS "Authenticated can delete chat files" ON storage.objects;
CREATE POLICY "Users can delete their own chat files"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'chat-files'
  AND (auth.uid())::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete their own chat images"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'chat-images'
  AND (auth.uid())::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete their own voice messages"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'voice-messages'
  AND (auth.uid())::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete their own avatar"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'avatars'
  AND (auth.uid())::text = (storage.foldername(name))[1]
);

-- Messages UPDATE: current policy lets any authenticated user update ANY column
-- on someone else's message. Lock it down so recipients can only stamp read_at,
-- and no one can rewrite content/urls/sender/etc.

CREATE OR REPLACE FUNCTION public.guard_message_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- Only the recipient can update, and only read_at may change.
  IF OLD.sender_id = auth.uid() THEN
    RAISE EXCEPTION 'Senders cannot modify their own messages';
  END IF;

  IF NEW.id             IS DISTINCT FROM OLD.id
     OR NEW.sender_id   IS DISTINCT FROM OLD.sender_id
     OR NEW.content     IS DISTINCT FROM OLD.content
     OR NEW.created_at  IS DISTINCT FROM OLD.created_at
     OR NEW.image_url   IS DISTINCT FROM OLD.image_url
     OR NEW.audio_url   IS DISTINCT FROM OLD.audio_url
     OR NEW.reply_to_id IS DISTINCT FROM OLD.reply_to_id
     OR NEW.file_url    IS DISTINCT FROM OLD.file_url
     OR NEW.file_name   IS DISTINCT FROM OLD.file_name
     OR NEW.file_type   IS DISTINCT FROM OLD.file_type
     OR NEW.video_url   IS DISTINCT FROM OLD.video_url
     OR NEW.pinned      IS DISTINCT FROM OLD.pinned
  THEN
    RAISE EXCEPTION 'Only read_at can be updated on a message';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_message_update ON public.messages;
CREATE TRIGGER trg_guard_message_update
BEFORE UPDATE ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.guard_message_update();

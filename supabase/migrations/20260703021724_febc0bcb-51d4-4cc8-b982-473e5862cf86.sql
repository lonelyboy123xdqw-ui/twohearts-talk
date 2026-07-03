-- Restore message cleanup to a high rolling limit so normal sending is not blocked.
CREATE OR REPLACE FUNCTION public.cleanup_old_messages()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  msg_count integer;
BEGIN
  SELECT count(*) INTO msg_count FROM public.messages;

  IF msg_count > 10000 THEN
    DELETE FROM public.messages
    WHERE id IN (
      SELECT id
      FROM public.messages
      ORDER BY created_at ASC, id ASC
      LIMIT 1000
    );
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_old_messages ON public.messages;
DROP TRIGGER IF EXISTS trigger_cleanup_old_messages ON public.messages;
CREATE TRIGGER trg_cleanup_old_messages
AFTER INSERT ON public.messages
FOR EACH STATEMENT
EXECUTE FUNCTION public.cleanup_old_messages();

-- Delete a storage object when a media attachment is removed from a message.
CREATE OR REPLACE FUNCTION public.cleanup_removed_message_media()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  p text;
BEGIN
  IF OLD.image_url IS NOT NULL AND (NEW.image_url IS NULL OR NEW.image_url <> OLD.image_url) THEN
    p := public.extract_storage_path(OLD.image_url, 'chat-images');
    IF p IS NOT NULL THEN
      DELETE FROM storage.objects WHERE bucket_id = 'chat-images' AND name = p;
    END IF;
  END IF;

  IF OLD.video_url IS NOT NULL AND (NEW.video_url IS NULL OR NEW.video_url <> OLD.video_url) THEN
    p := public.extract_storage_path(OLD.video_url, 'chat-files');
    IF p IS NOT NULL THEN
      DELETE FROM storage.objects WHERE bucket_id = 'chat-files' AND name = p;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_removed_message_media ON public.messages;
CREATE TRIGGER trg_cleanup_removed_message_media
AFTER UPDATE OF image_url, video_url ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_removed_message_media();

-- Keep only a rolling media sidebar: after 100 photos/videos, remove the oldest 10 attachments.
CREATE OR REPLACE FUNCTION public.cleanup_old_media_attachments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  media_count integer;
BEGIN
  SELECT count(*) INTO media_count
  FROM public.messages
  WHERE image_url IS NOT NULL OR video_url IS NOT NULL;

  IF media_count > 100 THEN
    UPDATE public.messages
    SET image_url = NULL,
        video_url = NULL
    WHERE id IN (
      SELECT id
      FROM public.messages
      WHERE image_url IS NOT NULL OR video_url IS NOT NULL
      ORDER BY created_at ASC, id ASC
      LIMIT 10
    );
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_old_media_attachments ON public.messages;
CREATE TRIGGER trg_cleanup_old_media_attachments
AFTER INSERT ON public.messages
FOR EACH STATEMENT
EXECUTE FUNCTION public.cleanup_old_media_attachments();
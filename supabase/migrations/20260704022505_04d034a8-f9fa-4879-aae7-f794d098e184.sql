
-- Disable auto-delete of media entirely, and raise soft cap to 1000 for future use.
DROP TRIGGER IF EXISTS trg_cleanup_old_media_attachments ON public.messages;
DROP TRIGGER IF EXISTS trg_cleanup_removed_message_media ON public.messages;
DROP TRIGGER IF EXISTS trg_cleanup_message_storage ON public.messages;

CREATE OR REPLACE FUNCTION public.cleanup_old_media_attachments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  media_count integer;
BEGIN
  -- Auto-delete disabled; kept as no-op with 1000 cap for reference.
  SELECT count(*) INTO media_count
  FROM public.messages
  WHERE image_url IS NOT NULL OR video_url IS NOT NULL;

  IF media_count > 1000 THEN
    -- intentionally no-op: media auto-delete disabled per user request
    NULL;
  END IF;

  RETURN NULL;
END;
$function$;

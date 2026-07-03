REVOKE ALL ON FUNCTION public.cleanup_old_messages() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_old_media_attachments() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_removed_message_media() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_old_messages() TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_old_media_attachments() TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_removed_message_media() TO service_role;
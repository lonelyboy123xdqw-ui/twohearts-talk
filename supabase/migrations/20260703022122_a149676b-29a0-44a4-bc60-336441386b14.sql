CREATE OR REPLACE FUNCTION public.extract_storage_path(public_url text, bucket text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT NULLIF(
    regexp_replace(public_url, '^.*/storage/v1/object/public/' || bucket || '/', ''),
    public_url
  );
$$;

REVOKE ALL ON FUNCTION public.cleanup_message_storage() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_message_storage() TO service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;
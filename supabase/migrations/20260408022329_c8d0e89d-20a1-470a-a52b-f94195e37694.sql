
CREATE OR REPLACE FUNCTION public.cleanup_old_messages()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  msg_count integer;
BEGIN
  SELECT count(*) INTO msg_count FROM public.messages;
  IF msg_count >= 9000 THEN
    DELETE FROM public.messages
    WHERE id IN (
      SELECT id FROM public.messages
      ORDER BY created_at ASC
      LIMIT 1000
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trigger_cleanup_old_messages
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.cleanup_old_messages();

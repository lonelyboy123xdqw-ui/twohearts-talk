CREATE OR REPLACE FUNCTION public.cleanup_old_messages()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.messages
  WHERE id IN (
    SELECT id FROM public.messages
    ORDER BY created_at DESC
    OFFSET 100
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_old_messages ON public.messages;
CREATE TRIGGER trg_cleanup_old_messages
AFTER INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.cleanup_old_messages();
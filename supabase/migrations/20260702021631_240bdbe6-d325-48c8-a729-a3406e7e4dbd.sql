DROP TRIGGER IF EXISTS trg_cleanup_old_messages ON public.messages;
DROP TRIGGER IF EXISTS cleanup_old_messages_trigger ON public.messages;
DROP FUNCTION IF EXISTS public.cleanup_old_messages() CASCADE;
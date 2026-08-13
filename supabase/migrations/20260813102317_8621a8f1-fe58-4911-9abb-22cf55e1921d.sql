DROP POLICY IF EXISTS "Users can delete their own messages" ON public.messages;
CREATE POLICY "Users can delete their own messages"
ON public.messages FOR DELETE TO authenticated
USING (auth.uid() = sender_id);

GRANT DELETE ON public.messages TO authenticated;

DROP TRIGGER IF EXISTS trg_cleanup_message_storage ON public.messages;
CREATE TRIGGER trg_cleanup_message_storage
AFTER DELETE ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.cleanup_message_storage();
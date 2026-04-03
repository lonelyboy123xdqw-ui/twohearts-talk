
ALTER TABLE public.messages ADD COLUMN read_at timestamp with time zone;

CREATE POLICY "Users can mark messages as read"
ON public.messages FOR UPDATE TO authenticated
USING (sender_id != auth.uid())
WITH CHECK (sender_id != auth.uid());

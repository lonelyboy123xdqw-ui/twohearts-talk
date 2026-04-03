
-- Add image_url column to messages
ALTER TABLE public.messages ADD COLUMN image_url text;

-- Create storage bucket for chat images
INSERT INTO storage.buckets (id, name, public) VALUES ('chat-images', 'chat-images', true);

-- Allow authenticated users to upload images
CREATE POLICY "Authenticated users can upload chat images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'chat-images');

-- Allow anyone to view chat images (bucket is public)
CREATE POLICY "Anyone can view chat images"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'chat-images');

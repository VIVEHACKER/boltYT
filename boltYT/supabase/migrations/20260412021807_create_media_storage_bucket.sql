/*
  # Create storage bucket for generated media

  1. Storage
    - `media` bucket for AI-generated images, audio, and video files
    - Public access enabled for serving media in the frontend
  
  2. Security
    - Authenticated users can upload files
    - Anyone can view files (needed for rendering in browser)
*/

INSERT INTO storage.buckets (id, name, public)
VALUES ('media', 'media', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated users can upload media"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'media');

CREATE POLICY "Authenticated users can update own media"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'media')
  WITH CHECK (bucket_id = 'media');

CREATE POLICY "Anyone can view media"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'media');

CREATE POLICY "Authenticated users can delete own media"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'media');

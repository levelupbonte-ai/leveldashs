-- Allow short videos (site reels) in the media bucket and register the media
-- inventory of blackpater.com (files currently self-hosted under /media).
UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'application/pdf', 'video/mp4', 'video/webm']
WHERE id = 'media';

-- Content block read by public/js/levelup.js: { "<file>": "<url>" }.
-- Values are switched to Supabase Storage URLs by scripts/migrate-media.mjs.
INSERT INTO public.content_blocks (website_id, organization_id, page, block_key, data) VALUES
  ('ws_ab9493c5857ed460', 'ee201882-1e28-438c-a7f7-41ae6ac53d23', 'site', 'media', '{
     "04e93a728b66.jpg": "/media/04e93a728b66.jpg",
     "0e1ee5dff864.webp": "/media/0e1ee5dff864.webp",
     "331bab387390.webp": "/media/331bab387390.webp",
     "3cf83596c4f4.mp4": "/media/3cf83596c4f4.mp4",
     "3e0be360f5ad.webp": "/media/3e0be360f5ad.webp",
     "50471a19bc72.webp": "/media/50471a19bc72.webp",
     "880bac4f1415.jpg": "/media/880bac4f1415.jpg",
     "db4bf6a012c1.webp": "/media/db4bf6a012c1.webp",
     "e5ea7d780407.jpg": "/media/e5ea7d780407.jpg",
     "fe552333c4cd.webp": "/media/fe552333c4cd.webp"
   }')
ON CONFLICT (website_id, page, block_key) DO NOTHING;

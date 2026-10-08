-- Confirmation emails are sent by each website's server (service role) at most
-- once per ticket. The server claims the row atomically:
--   UPDATE ... SET confirmation_sent_at = now()
--   WHERE website_id = $1 AND ticket_code = $2 AND confirmation_sent_at IS NULL
-- and only emails the address stored with the record.
ALTER TABLE public.appointments ADD COLUMN confirmation_sent_at timestamptz;
ALTER TABLE public.waitlist_entries ADD COLUMN confirmation_sent_at timestamptz;
ALTER TABLE public.form_submissions ADD COLUMN confirmation_sent_at timestamptz;

-- Final Stop: values that were still hard-coded in the site.
UPDATE public.website_settings
SET value = value || '{"emails": ["appointments@finalstop.org", "contact@finalstop.org"]}'::jsonb
WHERE website_id = 'ws_d5e600b7dc2ec9a9' AND key = 'contact';

UPDATE public.website_settings
SET value = value || '{
  "short_name": "FINAL STOP",
  "tagline": "Hair Artistry & Grooming",
  "description": "San Diego''s premier unisex destination for precision haircutting, razor fading, and master protective braids. Over 20 years of hands-on mastery by Mika and Lusca in a relaxed vintage lounge.",
  "email_from_name": "Final Stop Barber Shop"
}'::jsonb
WHERE website_id = 'ws_d5e600b7dc2ec9a9' AND key = 'branding';

UPDATE public.website_settings
SET value = value || '{"code": "FINALSTOP15", "discount_label": "15% off"}'::jsonb
WHERE website_id = 'ws_d5e600b7dc2ec9a9' AND key = 'promo_popup';

UPDATE public.team_members SET data = data || '{"gallery_label": "Girls’ Braids & Locs"}'::jsonb
WHERE website_id = 'ws_d5e600b7dc2ec9a9' AND slug = 'mika';
UPDATE public.team_members SET data = data || '{"gallery_label": "Boys’ Cuts & Fades"}'::jsonb
WHERE website_id = 'ws_d5e600b7dc2ec9a9' AND slug = 'lusca';

INSERT INTO public.content_blocks (website_id, organization_id, page, block_key, data) VALUES
  ('ws_d5e600b7dc2ec9a9', 'd2d91733-77fe-4840-8a47-4564de49dd29', 'home', 'gallery_banner', '{
     "image_url": "https://i.ibb.co/Y4yKyxRB/Chat-GPT-Image-Sep-6-2026-03-26-27-PM.png",
     "alt": "Exclusive Final Stop Signature Styles & Finishes",
     "eyebrow": "Final Stop Barber Shop • Mika & Lusca",
     "heading": "Master Barber Artistry Portfolio",
     "title": "Final Stop Signature Styles Showcase",
     "category": "Master Collection",
     "credit": "Mika & Lusca (Over 20 Years Experience)",
     "description": "A curated showcase of our master craft: Mika''s protective braids & locs for women & girls, and Lusca''s precision skin fades, beard architecture & boys'' cuts."
   }')
ON CONFLICT (website_id, page, block_key) DO NOTHING;

-- Platform seed: LevelUp's own organization/websites and the first client sites.
-- Fixed ids so each deployment can be configured with its WEBSITE_ID.
-- Idempotent (ON CONFLICT DO NOTHING). Owners are attached later, once their
-- Supabase accounts exist (see docs/database.md).

-- Reviews can carry source metadata (Google badge, price range, ...).
ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object');

INSERT INTO public.organizations (id, slug, name) VALUES
  ('716c151f-1c1f-4ba6-a02c-53ab6a9aa169', 'levelup-ecosystem', 'LevelUp Ecosystem'),
  ('d2d91733-77fe-4840-8a47-4564de49dd29', 'final-stop-barbershop', 'Final Stop Barber Shop & Salon'),
  ('ee201882-1e28-438c-a7f7-41ae6ac53d23', 'black-pater', 'Black Pater')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.websites (id, organization_id, name, primary_domain, site_type, status) VALUES
  ('ws_6e797257f5b32b86', '716c151f-1c1f-4ba6-a02c-53ab6a9aa169', 'LevelUp Ecosystem', 'levelup-ecosystem.com', 'corporate', 'active'),
  ('ws_871c0924a6afc646', '716c151f-1c1f-4ba6-a02c-53ab6a9aa169', 'LevelStudio', 'studio.levelup-ecosystem.com', 'saas', 'active'),
  ('ws_d5e600b7dc2ec9a9', 'd2d91733-77fe-4840-8a47-4564de49dd29', 'Final Stop Barber Shop & Salon', 'finalstop.org', 'barbershop', 'active'),
  ('ws_ab9493c5857ed460', 'ee201882-1e28-438c-a7f7-41ae6ac53d23', 'Black Pater', 'blackpater.com', 'creator', 'active')
ON CONFLICT (id) DO NOTHING;

-- LevelUp's own sites do not show the "Powered by" badge.
UPDATE public.websites SET show_powered_by = false
WHERE id IN ('ws_6e797257f5b32b86', 'ws_871c0924a6afc646');

INSERT INTO public.website_features (website_id, organization_id, feature_key)
SELECT v.website_id, w.organization_id, v.feature_key
FROM (VALUES
  ('ws_6e797257f5b32b86', 'contact_form'), ('ws_6e797257f5b32b86', 'newsletter'),
  ('ws_871c0924a6afc646', 'contact_form'),
  ('ws_d5e600b7dc2ec9a9', 'services'), ('ws_d5e600b7dc2ec9a9', 'team'), ('ws_d5e600b7dc2ec9a9', 'gallery'),
  ('ws_d5e600b7dc2ec9a9', 'reviews'), ('ws_d5e600b7dc2ec9a9', 'bookings'), ('ws_d5e600b7dc2ec9a9', 'waitlist'),
  ('ws_d5e600b7dc2ec9a9', 'quotes'), ('ws_d5e600b7dc2ec9a9', 'newsletter'), ('ws_d5e600b7dc2ec9a9', 'contact_form'),
  ('ws_d5e600b7dc2ec9a9', 'business_hours'), ('ws_d5e600b7dc2ec9a9', 'announcements'), ('ws_d5e600b7dc2ec9a9', 'promotions'),
  ('ws_ab9493c5857ed460', 'contact_form'), ('ws_ab9493c5857ed460', 'blog'), ('ws_ab9493c5857ed460', 'payments')
) AS v(website_id, feature_key)
JOIN public.websites w ON w.id = v.website_id
ON CONFLICT (website_id, feature_key) DO NOTHING;

-- Final Stop settings (previously hard-coded / in localStorage / Firestore shop_config).
INSERT INTO public.website_settings (website_id, organization_id, key, value) VALUES
  ('ws_d5e600b7dc2ec9a9', 'd2d91733-77fe-4840-8a47-4564de49dd29', 'tickets', '{"prefix": "FS"}'),
  ('ws_d5e600b7dc2ec9a9', 'd2d91733-77fe-4840-8a47-4564de49dd29', 'waitlist', '{"open": false, "minutes_per_client": 30}'),
  ('ws_d5e600b7dc2ec9a9', 'd2d91733-77fe-4840-8a47-4564de49dd29', 'contact', '{
     "phones": [
       {"label": "Mika · Braids & Locs", "display": "(619) 928-7084", "tel": "+16199287084", "team_member": "mika"},
       {"label": "Lusca · Haircuts & Fades", "display": "(619) 886-1267", "tel": "+16198861267", "team_member": "lusca"}
     ],
     "address": "4748 University Ave, San Diego, CA 92105",
     "maps_url": "https://maps.app.goo.gl/tUej1WdvZRudfqVX6",
     "coordinates": {"lat": 32.7497911, "lng": -117.0924401}
   }'),
  ('ws_d5e600b7dc2ec9a9', 'd2d91733-77fe-4840-8a47-4564de49dd29', 'hours', '{
     "summary": ["Monday - Saturday: 10:00 AM - 6:00 PM", "Sunday: Closed"],
     "weekly": {"mon": ["10:00", "18:00"], "tue": ["10:00", "18:00"], "wed": ["10:00", "18:00"], "thu": ["10:00", "18:00"], "fri": ["10:00", "18:00"], "sat": ["10:00", "18:00"], "sun": null}
   }'),
  ('ws_d5e600b7dc2ec9a9', 'd2d91733-77fe-4840-8a47-4564de49dd29', 'booking', '{
     "time_slots": ["10:00", "10:45", "11:30", "12:15", "13:00", "13:45", "14:30", "15:15", "16:00", "16:45", "17:30"],
     "lead_time_hours": 2,
     "cancellation_policy": "Free rescheduling or cancellation up to 2 hours before your appointment."
   }'),
  ('ws_d5e600b7dc2ec9a9', 'd2d91733-77fe-4840-8a47-4564de49dd29', 'social', '{
     "instagram": "https://instagram.com/finalstopbarbershop",
     "tiktok": "https://tiktok.com/@finalstopbarbershop"
   }'),
  ('ws_d5e600b7dc2ec9a9', 'd2d91733-77fe-4840-8a47-4564de49dd29', 'promo_popup', '{"enabled": true, "delay_seconds": 5}'),
  ('ws_d5e600b7dc2ec9a9', 'd2d91733-77fe-4840-8a47-4564de49dd29', 'branding', '{
     "logo_url": "https://i.ibb.co/FR3LpjN/Chat-GPT-Image-Sep-6-2026-01-08-28-PM.png",
     "logo_alt": "Final Stop Barber Shop Logo"
   }')
ON CONFLICT (website_id, key) DO NOTHING;

INSERT INTO public.content_blocks (website_id, organization_id, page, block_key, data) VALUES
  ('ws_d5e600b7dc2ec9a9', 'd2d91733-77fe-4840-8a47-4564de49dd29', 'home', 'hero', '{
     "title_line_1": "The Pinnacle",
     "title_line_2": "of Hair Artistry & Grooming",
     "description": "San Diego’s premier unisex destination for precision haircuts, beard sculpting, and master protective braids. Powered by Mika (specializing in women’s & girls’ knotless braids & locs) and Lusca (specializing in skin fades, men’s & boys’ styling).",
     "primary_cta": "Book Appointment",
     "secondary_cta": "Explore Our Work"
   }')
ON CONFLICT (website_id, page, block_key) DO NOTHING;




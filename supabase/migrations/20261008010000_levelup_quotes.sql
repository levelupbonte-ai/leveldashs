-- levelup-ecosystem.com: "Start a project" briefs are quote requests
-- (form_type 'quote' requires the 'quotes' feature).
INSERT INTO public.website_features (website_id, organization_id, feature_key)
SELECT w.id, w.organization_id, 'quotes'
FROM public.websites w
WHERE w.id = 'ws_6e797257f5b32b86'
ON CONFLICT DO NOTHING;

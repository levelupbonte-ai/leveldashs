-- Showcase CMS (2/3): get_site_bundle exposes the showcase (see 20261017100000_showcase_cms.sql).

-- ============================================================================
-- Public read path: get_site_bundle gains "showcase" (feature showcase_cms)
-- ============================================================================
-- Unchanged except for the new key: published templates and projects in
-- display order, and every section row (the site needs disabled ones too).
-- Internal columns (ids, tenant keys, timestamps) are left out.

CREATE OR REPLACE FUNCTION public.get_site_bundle(p_website_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_site jsonb;
  v_features text[];
BEGIN
  IF p_website_id IS NULL OR p_website_id !~ '^ws_[a-z0-9]{8,32}$' THEN
    RETURN NULL;
  END IF;

  v_site := public.get_public_website(p_website_id);
  IF v_site IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT coalesce(array_agg(f), '{}') INTO v_features
  FROM jsonb_array_elements_text(v_site -> 'features') AS f;

  RETURN v_site || jsonb_build_object(
    'generated_at', now(),
    'blocks', coalesce((
      SELECT jsonb_object_agg(page, blocks)
      FROM (
        SELECT b.page, jsonb_object_agg(b.block_key, b.data ORDER BY b.sort_order) AS blocks
        FROM public.content_blocks b
        WHERE b.website_id = p_website_id AND b.status = 'published'
        GROUP BY b.page
      ) p
    ), '{}'::jsonb),
    'services', CASE WHEN 'services' = ANY (v_features) THEN coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'slug', s.slug, 'name', s.name, 'category', s.category, 'description', s.description,
        'price_cents', s.price_cents, 'price_label', s.price_label, 'currency', s.currency,
        'duration_minutes', s.duration_minutes, 'duration_label', s.duration_label,
        'badge', s.badge, 'featured', s.featured, 'inclusions', to_jsonb(s.inclusions),
        'image_url', s.image_url, 'team_member', tm.slug, 'data', s.data
      ) ORDER BY s.sort_order, s.created_at)
      FROM (SELECT * FROM public.services
            WHERE website_id = p_website_id AND status = 'published'
            ORDER BY sort_order, created_at LIMIT 500) s
      LEFT JOIN public.team_members tm ON tm.id = s.team_member_id
    ), '[]'::jsonb) ELSE '[]'::jsonb END,
    'team', CASE WHEN 'team' = ANY (v_features) THEN coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'slug', t.slug, 'name', t.name, 'role', t.role, 'bio', t.bio,
        'image_url', t.image_url, 'tags', to_jsonb(t.tags), 'data', t.data
      ) ORDER BY t.sort_order, t.created_at)
      FROM (SELECT * FROM public.team_members
            WHERE website_id = p_website_id AND status = 'published'
            ORDER BY sort_order, created_at LIMIT 200) t
    ), '[]'::jsonb) ELSE '[]'::jsonb END,
    'gallery', CASE WHEN 'gallery' = ANY (v_features) THEN coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'title', g.title, 'description', g.description, 'category', g.category,
        'audience', g.audience, 'image_url', g.image_url, 'tags', to_jsonb(g.tags),
        'team_member', tm.slug
      ) ORDER BY g.sort_order, g.created_at)
      FROM (SELECT * FROM public.gallery_items
            WHERE website_id = p_website_id AND status = 'published'
            ORDER BY sort_order, created_at LIMIT 500) g
      LEFT JOIN public.team_members tm ON tm.id = g.team_member_id
    ), '[]'::jsonb) ELSE '[]'::jsonb END,
    'reviews', CASE WHEN 'reviews' = ANY (v_features) THEN coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'author', r.author, 'rating', r.rating, 'comment', r.comment,
        'review_date', r.review_date, 'source', r.source, 'data', r.data
      ) ORDER BY r.sort_order, r.created_at)
      FROM (SELECT * FROM public.reviews
            WHERE website_id = p_website_id AND status = 'published'
            ORDER BY sort_order, created_at LIMIT 200) r
    ), '[]'::jsonb) ELSE '[]'::jsonb END,
    'faq', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'category', q.category, 'question', q.question, 'answer', q.answer
      ) ORDER BY q.sort_order, q.created_at)
      FROM (SELECT * FROM public.faq_items
            WHERE website_id = p_website_id AND status = 'published'
            ORDER BY sort_order, created_at LIMIT 200) q
    ), '[]'::jsonb),
    'announcements', CASE WHEN v_features && ARRAY['announcements', 'promotions', 'blog'] THEN coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'slug', a.slug, 'title', a.title, 'content', a.content, 'image_url', a.image_url,
        'published_at', a.published_at, 'expires_at', a.expires_at
      ) ORDER BY a.published_at DESC NULLS LAST, a.created_at DESC)
      FROM (SELECT * FROM public.announcements
            WHERE website_id = p_website_id AND status = 'published'
              AND (published_at IS NULL OR published_at <= now())
              AND (expires_at IS NULL OR expires_at > now())
            ORDER BY published_at DESC NULLS LAST, created_at DESC LIMIT 100) a
    ), '[]'::jsonb) ELSE '[]'::jsonb END,
    'showcase', CASE WHEN 'showcase_cms' = ANY (v_features) THEN jsonb_build_object(
      'templates', coalesce((
        SELECT jsonb_agg(to_jsonb(st) - ARRAY['id', 'website_id', 'organization_id', 'created_at', 'status']
                         ORDER BY st.sort_order, st.created_at)
        FROM (SELECT * FROM public.showcase_templates
              WHERE website_id = p_website_id AND status = 'published'
              ORDER BY sort_order, created_at LIMIT 100) st
      ), '[]'::jsonb),
      'projects', coalesce((
        SELECT jsonb_agg(to_jsonb(sp) - ARRAY['id', 'website_id', 'organization_id', 'created_at', 'status']
                         ORDER BY sp.sort_order, sp.created_at)
        FROM (SELECT * FROM public.showcase_projects
              WHERE website_id = p_website_id AND status = 'published'
              ORDER BY sort_order, created_at LIMIT 100) sp
      ), '[]'::jsonb),
      'sections', coalesce((
        SELECT jsonb_agg(to_jsonb(ss) - ARRAY['id', 'website_id', 'organization_id', 'created_at']
                         ORDER BY ss.page, ss.sort_order, ss.created_at)
        FROM (SELECT * FROM public.showcase_sections
              WHERE website_id = p_website_id
              ORDER BY page, sort_order, created_at LIMIT 300) ss
      ), '[]'::jsonb)
    ) ELSE NULL END
  );
END;
$function$;

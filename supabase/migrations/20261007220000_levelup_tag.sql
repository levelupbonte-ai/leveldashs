-- LevelUp tag (levelup.js): install verification.
-- The script pings once per visitor session; the ping is recorded only when it
-- comes from one of the website's allowed origins, at most every 10 minutes.
-- The dashboard shows the tag as installed when a ping arrived recently.

ALTER TABLE public.websites
  ADD COLUMN IF NOT EXISTS tag_last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS tag_last_seen_origin text,
  ADD COLUMN IF NOT EXISTS tag_version text;

CREATE OR REPLACE FUNCTION public.tag_ping(p_website_id text, p_version text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_origin text;
  v_allowed text[];
BEGIN
  IF p_website_id IS NULL OR p_website_id !~ '^ws_[a-z0-9]{8,32}$' OR NOT private.is_website_live(p_website_id) THEN
    RETURN false;
  END IF;
  BEGIN
    v_origin := lower(nullif(current_setting('request.headers', true), '')::json ->> 'origin');
  EXCEPTION WHEN others THEN
    v_origin := NULL;
  END;
  SELECT allowed_origins INTO v_allowed FROM public.websites WHERE id = p_website_id;
  -- Only a browser on one of the client's own domains proves the install.
  IF v_origin IS NULL OR cardinality(v_allowed) = 0 OR NOT (v_origin = ANY (v_allowed)) THEN
    RETURN false;
  END IF;

  UPDATE public.websites
  SET tag_last_seen_at = now(),
      tag_last_seen_origin = v_origin,
      tag_version = left(regexp_replace(coalesce(p_version, ''), '[^0-9A-Za-z._-]', '', 'g'), 20)
  WHERE id = p_website_id
    AND (tag_last_seen_at IS NULL OR tag_last_seen_at < now() - interval '10 minutes');
  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tag_ping(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tag_ping(text, text) TO anon, authenticated;


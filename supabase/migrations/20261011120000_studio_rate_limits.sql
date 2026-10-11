-- LevelStudio abuse limits that must hold across serverless instances
-- (chat, inspiration, attachment analysis, share links). One counter per day,
-- bucket and subject (account, anonymous cookie, hashed IP or browser
-- fingerprint). Written only by the LevelStudio server (service role).
CREATE TABLE IF NOT EXISTS public.studio_rate_limits (
  day date NOT NULL,
  bucket text NOT NULL CHECK (bucket ~ '^[a-z_]{1,32}$'),
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 128),
  hits integer NOT NULL DEFAULT 0 CHECK (hits >= 0),
  PRIMARY KEY (day, bucket, subject)
);

ALTER TABLE public.studio_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.studio_rate_limits FROM PUBLIC, anon, authenticated;

-- Counts one call for every subject of the visitor and returns the highest
-- count, or raises PT429 (HTTP 429) once any subject reached p_limit today, so
-- rotating one identifier does not reset the limit. Rows older than a week are
-- pruned now and then.
CREATE OR REPLACE FUNCTION public.studio_rate_hit(
  p_day date,
  p_bucket text,
  p_subjects text[],
  p_limit integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_subjects text[];
  v_hits integer;
BEGIN
  IF p_limit < 1 OR p_limit > 100000 OR p_bucket IS NULL OR p_bucket !~ '^[a-z_]{1,32}$' THEN
    RAISE EXCEPTION 'Invalid rate limit request' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(DISTINCT left(s, 128)) INTO v_subjects
  FROM unnest(coalesce(p_subjects, '{}')) AS s WHERE s IS NOT NULL AND s <> '';
  IF v_subjects IS NULL THEN
    RAISE EXCEPTION 'No subject' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.studio_rate_limits (day, bucket, subject, hits)
  SELECT p_day, p_bucket, s, 0 FROM unnest(v_subjects) AS s
  ON CONFLICT (day, bucket, subject) DO NOTHING;
  -- Lock the rows so concurrent calls queue instead of all passing.
  PERFORM 1 FROM public.studio_rate_limits
  WHERE day = p_day AND bucket = p_bucket AND subject = ANY (v_subjects)
  ORDER BY subject FOR UPDATE;

  SELECT max(hits) INTO v_hits FROM public.studio_rate_limits
  WHERE day = p_day AND bucket = p_bucket AND subject = ANY (v_subjects);
  IF v_hits >= p_limit THEN
    RAISE EXCEPTION 'Rate limit reached' USING ERRCODE = 'PT429';
  END IF;

  UPDATE public.studio_rate_limits SET hits = hits + 1
  WHERE day = p_day AND bucket = p_bucket AND subject = ANY (v_subjects);

  IF random() < 0.01 THEN
    DELETE FROM public.studio_rate_limits WHERE day < p_day - 7;
  END IF;
  RETURN v_hits + 1;
END;
$$;

REVOKE ALL ON FUNCTION public.studio_rate_hit(date, text, text[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.studio_rate_hit(date, text, text[], integer) TO service_role;

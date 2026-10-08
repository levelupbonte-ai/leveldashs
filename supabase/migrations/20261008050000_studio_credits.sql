-- LevelStudio daily credits: each action has a cost (questions 1, refinement 2,
-- full build 5). Charged atomically across every subject of the visitor
-- (account or anonymous cookie, IP, browser fingerprint): the highest balance
-- used among them decides, so rotating one identifier does not reset the quota.
CREATE OR REPLACE FUNCTION public.studio_consume_credits(
  p_day date,
  p_subjects text[],
  p_cost integer,
  p_limit integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_subjects text[];
  v_used integer;
BEGIN
  IF p_cost < 0 OR p_cost > 50 OR p_limit < 0 THEN
    RAISE EXCEPTION 'Invalid credit request' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(DISTINCT left(s, 128)) INTO v_subjects
  FROM unnest(coalesce(p_subjects, '{}')) AS s WHERE s IS NOT NULL AND s <> '';
  IF v_subjects IS NULL THEN
    RAISE EXCEPTION 'No subject' USING ERRCODE = '22023';
  END IF;

  -- Lock the subject rows (create them if needed) so concurrent requests queue.
  INSERT INTO public.studio_usage (day, subject, used)
  SELECT p_day, s, 0 FROM unnest(v_subjects) AS s
  ON CONFLICT (day, subject) DO NOTHING;
  PERFORM 1 FROM public.studio_usage
  WHERE day = p_day AND subject = ANY (v_subjects)
  ORDER BY subject FOR UPDATE;

  SELECT max(used) INTO v_used FROM public.studio_usage
  WHERE day = p_day AND subject = ANY (v_subjects);
  IF p_cost > 0 AND v_used + p_cost > p_limit THEN
    RAISE EXCEPTION 'Not enough credits' USING ERRCODE = 'PT429';
  END IF;

  IF p_cost > 0 THEN
    UPDATE public.studio_usage SET used = used + p_cost
    WHERE day = p_day AND subject = ANY (v_subjects);
  END IF;
  RETURN v_used + p_cost;
END;
$$;

REVOKE ALL ON FUNCTION public.studio_consume_credits(date, text[], integer, integer) FROM public, anon, authenticated;

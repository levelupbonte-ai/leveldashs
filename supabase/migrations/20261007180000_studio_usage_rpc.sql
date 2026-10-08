-- LevelStudio daily generation quota. Called only by the LevelStudio server
-- (service role). Increments every subject key (user / cookie / IP / browser
-- fingerprint) atomically and returns the highest counter.
CREATE OR REPLACE FUNCTION public.studio_consume_usage(p_day date, p_subjects text[], p_consume boolean DEFAULT true)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_max integer := 0;
  v_subject text;
  v_used integer;
BEGIN
  FOREACH v_subject IN ARRAY coalesce(p_subjects, '{}') LOOP
    IF p_consume THEN
      INSERT INTO public.studio_usage (day, subject, used) VALUES (p_day, left(v_subject, 128), 1)
      ON CONFLICT (day, subject) DO UPDATE SET used = public.studio_usage.used + 1
      RETURNING used INTO v_used;
    ELSE
      SELECT used INTO v_used FROM public.studio_usage WHERE day = p_day AND subject = left(v_subject, 128);
    END IF;
    v_max := greatest(v_max, coalesce(v_used, 0));
  END LOOP;
  RETURN v_max;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.studio_consume_usage(date, text[], boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.studio_consume_usage(date, text[], boolean) TO service_role;

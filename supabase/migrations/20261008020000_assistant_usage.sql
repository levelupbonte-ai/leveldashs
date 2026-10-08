-- Dashboard AI assistant: per-organization daily message allowance, so one
-- client can never drain the shared Gemini quota.
CREATE TABLE IF NOT EXISTS public.ai_usage (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  day date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  feature text NOT NULL DEFAULT 'assistant',
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, day, feature)
);
ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;
-- No policies: only the SECURITY DEFINER function below touches it.

CREATE OR REPLACE FUNCTION public.assistant_consume(p_organization_id uuid, p_limit integer DEFAULT 60)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
  v_limit integer := least(greatest(coalesce(p_limit, 60), 1), 200);
BEGIN
  IF auth.uid() IS NULL OR NOT private.has_org_role(p_organization_id, 'viewer') THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = 'PT403';
  END IF;
  INSERT INTO public.ai_usage AS u (organization_id, feature, count)
  VALUES (p_organization_id, 'assistant', 1)
  ON CONFLICT (organization_id, day, feature) DO UPDATE SET count = u.count + 1
  RETURNING u.count INTO v_count;
  IF v_count > v_limit THEN
    RAISE EXCEPTION 'Daily assistant limit reached' USING ERRCODE = 'PT429';
  END IF;
  RETURN v_limit - v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.assistant_consume(uuid, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.assistant_consume(uuid, integer) TO authenticated;

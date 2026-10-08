-- The daily assistant allowance is fixed server-side (60 per organization);
-- the p_limit argument is kept for signature compatibility but ignored, so a
-- caller cannot raise it.
CREATE OR REPLACE FUNCTION public.assistant_consume(p_organization_id uuid, p_limit integer DEFAULT 60)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
  v_limit constant integer := 60;
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

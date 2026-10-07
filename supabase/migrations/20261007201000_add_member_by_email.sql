-- Lets organization admins add an existing LevelUp account to their
-- organization by e-mail (the browser cannot look up other users' ids).
-- Same rules as the organization_members policies: admin+ to add, owner to
-- grant 'owner'. Returns 'added', 'updated' or 'not_found'.

CREATE OR REPLACE FUNCTION public.add_organization_member(p_organization_id uuid, p_email text, p_role text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid;
  v_existing text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_role NOT IN ('owner', 'admin', 'editor', 'viewer') THEN
    RAISE EXCEPTION 'Invalid role' USING ERRCODE = '22023';
  END IF;
  IF NOT private.has_org_role(p_organization_id, CASE WHEN p_role = 'owner' THEN 'owner' ELSE 'admin' END) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = 'PT403';
  END IF;

  SELECT id INTO v_user FROM auth.users
  WHERE lower(email) = lower(btrim(p_email)) AND deleted_at IS NULL
  LIMIT 1;
  IF v_user IS NULL THEN
    RETURN 'not_found';
  END IF;

  SELECT role INTO v_existing FROM public.organization_members
  WHERE organization_id = p_organization_id AND user_id = v_user;

  IF v_existing IS NULL THEN
    INSERT INTO public.organization_members (organization_id, user_id, role)
    VALUES (p_organization_id, v_user, p_role);
    RETURN 'added';
  END IF;

  -- Changing an owner's role is reserved to owners.
  IF v_existing = 'owner' AND NOT private.has_org_role(p_organization_id, 'owner') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = 'PT403';
  END IF;
  UPDATE public.organization_members SET role = p_role
  WHERE organization_id = p_organization_id AND user_id = v_user;
  RETURN 'updated';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.add_organization_member(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_organization_member(uuid, text, text) TO authenticated;

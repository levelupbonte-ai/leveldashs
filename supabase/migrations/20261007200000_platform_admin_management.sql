-- LevelUp staff (public.platform_admins) manage every client website from the
-- dashboard: they act with up to 'admin' rights in every organization, so
-- content, inbox, media and Storage policies apply to them without new
-- policies. 'owner'-only actions (granting/removing owners) stay with the
-- client's real owners.

CREATE OR REPLACE FUNCTION private.has_org_role(org_id uuid, min_role text DEFAULT 'viewer')
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members m
    JOIN public.organizations o ON o.id = m.organization_id
    WHERE m.organization_id = org_id
      AND m.user_id = (SELECT auth.uid())
      AND o.status <> 'archived'
      AND private.role_rank(m.role) >= private.role_rank(min_role)
  )
  OR (
    min_role <> 'owner'
    AND private.is_platform_admin()
    AND EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = org_id AND o.status <> 'archived')
  );
$$;

import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { ACTIVE_ORG_COOKIE, ACTIVE_WEBSITE_COOKIE } from './cookies';
import type { DashboardOrg, DashboardSession, DashboardWebsite, OrgRole } from './types';

// Everything here is read with the user's own token, so Row Level Security
// decides what is visible. The cookies only pick among rows already allowed.
export const getDashboardSession = cache(async (): Promise<DashboardSession | null> => {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [profileRes, adminRes, membershipRes] = await Promise.all([
    supabase.from('profiles').select('full_name, avatar_url').eq('id', user.id).maybeSingle(),
    supabase.from('platform_admins').select('user_id').eq('user_id', user.id).maybeSingle(),
    supabase
      .from('organization_members')
      .select('role, organizations (id, name, slug, status)')
      .eq('user_id', user.id)
  ]);

  const isPlatformAdmin = !!adminRes.data;
  const roles = new Map<string, OrgRole>();
  for (const row of membershipRes.data ?? []) {
    const org = row.organizations as unknown as { id: string } | null;
    if (org) roles.set(org.id, row.role as OrgRole);
  }

  // Platform admins see every organization (RLS allows it); members see theirs.
  const orgQuery = supabase
    .from('organizations')
    .select('id, name, slug')
    .neq('status', 'archived')
    .order('name');
  const { data: orgRows } = isPlatformAdmin
    ? await orgQuery
    : await orgQuery.in(
        'id',
        roles.size ? [...roles.keys()] : ['00000000-0000-0000-0000-000000000000']
      );

  const organizations: DashboardOrg[] = (orgRows ?? []).map((o) => ({
    id: o.id,
    name: o.name,
    slug: o.slug,
    role: roles.get(o.id) ?? null
  }));

  const cookieStore = await cookies();
  const wantedOrg = cookieStore.get(ACTIVE_ORG_COOKIE)?.value;
  const activeOrg =
    organizations.find((o) => o.id === wantedOrg) ??
    organizations.find((o) => o.role !== null) ??
    organizations[0] ??
    null;

  let websites: DashboardWebsite[] = [];
  if (activeOrg) {
    const { data: siteRows } = await supabase
      .from('websites')
      .select('id, name, primary_domain, status, website_features (feature_key, enabled)')
      .eq('organization_id', activeOrg.id)
      .order('name');
    websites = (siteRows ?? []).map((w) => ({
      id: w.id,
      name: w.name,
      primaryDomain: w.primary_domain,
      status: w.status,
      features: ((w.website_features ?? []) as { feature_key: string; enabled: boolean }[])
        .filter((f) => f.enabled)
        .map((f) => f.feature_key)
    }));
  }

  const wantedSite = cookieStore.get(ACTIVE_WEBSITE_COOKIE)?.value;
  const activeWebsite = websites.find((w) => w.id === wantedSite) ?? websites[0] ?? null;

  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const email = user.email ?? '';
  return {
    user: {
      id: user.id,
      email,
      fullName:
        profileRes.data?.full_name ||
        (typeof meta.full_name === 'string' ? meta.full_name : '') ||
        email.split('@')[0],
      avatarUrl:
        profileRes.data?.avatar_url ||
        (typeof meta.avatar_url === 'string' ? meta.avatar_url : null)
    },
    isPlatformAdmin,
    organizations,
    activeOrg,
    websites,
    activeWebsite
  };
});

/** For pages under /dashboard: the session, or a redirect to sign-in. */
export async function requireDashboardSession(): Promise<DashboardSession> {
  const session = await getDashboardSession();
  if (!session) redirect('/auth/sign-in');
  return session;
}

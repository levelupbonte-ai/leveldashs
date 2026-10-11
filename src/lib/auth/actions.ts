'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { ACTIVE_ORG_COOKIE, ACTIVE_WEBSITE_COOKIE, preferenceCookie } from './cookies';

// Server actions are public endpoints: every argument is validated first.
const OrganizationId = z.string().uuid();
const WebsiteId = z.string().regex(/^ws_[a-z0-9]{8,32}$/);

export async function setActiveOrganization(organizationId: string) {
  if (!OrganizationId.safeParse(organizationId).success) throw new Error('Invalid organization');
  const supabase = await createClient();
  // RLS returns the row only if the user may see this organization.
  const { data } = await supabase
    .from('organizations')
    .select('id')
    .eq('id', organizationId)
    .maybeSingle();
  if (!data) throw new Error('Organization not found');
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ORG_COOKIE, organizationId, preferenceCookie);
  cookieStore.delete(ACTIVE_WEBSITE_COOKIE);
}

export async function setActiveWebsite(websiteId: string) {
  if (!WebsiteId.safeParse(websiteId).success) throw new Error('Invalid website');
  const supabase = await createClient();
  const { data } = await supabase
    .from('websites')
    .select('id, organization_id')
    .eq('id', websiteId)
    .maybeSingle();
  if (!data) throw new Error('Website not found');
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ORG_COOKIE, data.organization_id, preferenceCookie);
  cookieStore.set(ACTIVE_WEBSITE_COOKIE, websiteId, preferenceCookie);
}

async function endSession(scope: 'global' | 'local') {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope });
  const cookieStore = await cookies();
  cookieStore.delete(ACTIVE_ORG_COOKIE);
  cookieStore.delete(ACTIVE_WEBSITE_COOKIE);
}

export async function signOut() {
  await endSession('global');
  redirect('/auth/sign-in');
}

/**
 * Automatic sign-out after inactivity (IdleTimeout): this browser only, so a
 * phone left signed in elsewhere keeps its session. The sign-in page explains why.
 */
export async function signOutIdle() {
  await endSession('local');
  redirect('/auth/sign-in?reason=idle');
}

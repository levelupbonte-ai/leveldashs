'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ACTIVE_ORG_COOKIE, ACTIVE_WEBSITE_COOKIE, preferenceCookie } from './cookies';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WEBSITE_ID = /^ws_[a-z0-9]{8,32}$/;

export async function setActiveOrganization(organizationId: string) {
  if (!UUID.test(organizationId)) throw new Error('Invalid organization');
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
  if (!WEBSITE_ID.test(websiteId)) throw new Error('Invalid website');
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

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const cookieStore = await cookies();
  cookieStore.delete(ACTIVE_ORG_COOKIE);
  cookieStore.delete(ACTIVE_WEBSITE_COOKIE);
  redirect('/auth/sign-in');
}

import 'server-only';
import type { Metadata } from 'next';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type { PublicForm } from '../api/types';

// A shared link or a busy client site can bring thousands of visitors at once:
// each form is read from the database at most every 30 seconds per server
// instance (every answer is still checked live by public_form_submit).
const TTL_MS = 30_000;
const recent = new Map<string, { at: number; form: PublicForm | null }>();

/** A published form as the public pages show it (public_form_get), or null. */
export const getPublicForm = cache(async (id: string): Promise<PublicForm | null> => {
  if (!/^f[a-z0-9]{10}$/.test(id)) return null;
  const hit = recent.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.form;
  const db = await createClient();
  const { data, error } = await db.rpc('public_form_get', { p_public_id: id });
  if (error) return null;
  const form = (data as PublicForm | null) ?? null;
  if (recent.size > 1000) recent.clear();
  recent.set(id, { at: Date.now(), form });
  return form;
});

/** Page title (form · business) and never in search results. */
export async function publicFormMetadata(id: string): Promise<Metadata> {
  const form = await getPublicForm(id);
  return {
    title: form
      ? `${form.settings.title || form.name}${form.site.name ? ` · ${form.site.name}` : ''}`
      : undefined,
    robots: { index: false, follow: false }
  };
}

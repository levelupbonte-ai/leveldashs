import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { HostedForm } from '@/features/forms/components/hosted-form';
import type { PublicForm } from '@/features/forms/api/types';
import { createClient } from '@/lib/supabase/server';
import { turnstileRequired } from '@/lib/turnstile';

// Public page of a LevelUp form: no sign-in, published forms only. The form,
// its look and the business name come from public_form_get (nothing internal).

// A shared link can bring thousands of visitors at once: each form is read from
// the database at most every 30 seconds per server instance (the answer itself
// is always checked live by public_form_submit).
const TTL_MS = 30_000;
const recent = new Map<string, { at: number; form: PublicForm | null }>();

const getForm = cache(async (id: string): Promise<PublicForm | null> => {
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

export async function generateMetadata({
  params
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const form = await getForm((await params).id);
  return {
    title: form
      ? `${form.settings.title || form.name}${form.site.name ? ` · ${form.site.name}` : ''}`
      : undefined,
    // Each business decides where to share its form: never in search results.
    robots: { index: false, follow: false }
  };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const form = await getForm((await params).id);
  if (!form) notFound();
  return <HostedForm form={form} captcha={turnstileRequired()} />;
}

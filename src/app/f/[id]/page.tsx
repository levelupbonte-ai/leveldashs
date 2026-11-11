import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { HostedForm } from '@/features/forms/components/hosted-form';
import { getPublicForm, publicFormMetadata } from '@/features/forms/server/get-form';
import { turnstileRequired } from '@/lib/turnstile';

// Public page of a LevelUp form: no sign-in, published forms only. The form,
// its look and the business name come from public_form_get (nothing internal).

export async function generateMetadata({
  params
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  return publicFormMetadata((await params).id);
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const form = await getPublicForm((await params).id);
  if (!form) notFound();
  return <HostedForm form={form} captcha={turnstileRequired()} />;
}

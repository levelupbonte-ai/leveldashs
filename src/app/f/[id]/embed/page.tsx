import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { HostedForm } from '@/features/forms/components/hosted-form';
import { getPublicForm, publicFormMetadata } from '@/features/forms/server/get-form';
import { turnstileRequired } from '@/lib/turnstile';

// The same form, made to live inside the client's own website (an iframe
// added by forms/embed.js or the LevelUp tag). Only the sites the client
// allows may frame it: the proxy sets frame-ancestors from
// public_form_embed_origins (see src/proxy.ts).

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
  return <HostedForm form={form} captcha={turnstileRequired()} embed />;
}

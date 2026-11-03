'use client';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { Icons } from '@/components/icons';
import { TurnstileWidget, type TurnstileHandle } from '@/features/auth/components/turnstile';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import type { FormField, FormValues, PublicForm, UploadedValue } from '../api/types';
import { prepareUpload } from '../lib/prepare-upload';
import { toPayload } from '../lib/fields';
import { FormRenderer, formTheme, type SubmitResult } from './form-renderer';

/** The hosted LevelUp form page (/f/[id]): the client's form, LevelUp's secure page. */
export function HostedForm({ form, captcha }: { form: PublicForm; captcha: boolean }) {
  const t = useTranslations('siteForms.public');
  const theme = formTheme(form.settings);
  const [token, setToken] = useState<string | null>(null);
  const widget = useRef<TurnstileHandle>(null);
  const [openedAt] = useState(() => Date.now());
  const honeypot = useRef<HTMLInputElement>(null);

  /** Books a private path for the file, then sends it straight to storage. */
  async function upload(
    field: FormField,
    picked: File
  ): Promise<UploadedValue | 'type' | 'size' | 'failed'> {
    const file = await prepareUpload(picked, field.accept ?? 'any');
    if (typeof file === 'string') return file;
    try {
      const res = await fetch(`/api/forms/${form.public_id}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          field: field.id,
          name: file.name,
          mime: file.blob.type,
          size: file.blob.size
        })
      });
      const body = (await res.json().catch(() => ({}))) as { path?: string; error?: string };
      if (!res.ok || !body.path)
        return body.error === 'type' ? 'type' : body.error === 'size' ? 'size' : 'failed';
      const { error } = await createClient()
        .storage.from('form-uploads')
        .upload(body.path, file.blob, { contentType: file.blob.type, upsert: false });
      if (error) return 'failed';
      return {
        path: body.path,
        name: file.name,
        preview: file.blob.type.startsWith('image/') ? URL.createObjectURL(file.blob) : null
      };
    } catch {
      return 'failed';
    }
  }

  async function submit(values: FormValues, consent: boolean): Promise<SubmitResult> {
    if (captcha && !token) return { ok: false, error: 'captcha' };
    try {
      const res = await fetch(`/api/forms/${form.public_id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          values: toPayload(form.fields, values),
          consent,
          website: honeypot.current?.value || undefined,
          turnstile: token ?? undefined,
          elapsed: Date.now() - openedAt
        })
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        ticket?: string;
        error?: string;
        field?: string;
      };
      if (res.ok && body.ok) return { ok: true, ticket: body.ticket };
      widget.current?.reset();
      if (body.error === 'invalid') return { ok: false, error: 'invalid', field: body.field };
      if (body.error === 'limit') return { ok: false, error: 'limit' };
      if (body.error === 'captcha') return { ok: false, error: 'captcha' };
      if (body.error === 'paused') return { ok: false, error: 'paused' };
      return { ok: false, error: 'unavailable' };
    } catch {
      return { ok: false, error: 'unavailable' };
    }
  }

  return (
    <main className={cn('flex min-h-dvh flex-col items-center px-4 py-8 sm:py-14', theme.page)}>
      <div className={cn('w-full', theme.maxWidth)}>
        <FormRenderer
          form={form}
          onSubmit={submit}
          onUpload={upload}
          beforeSubmit={
            <>
              {/* Honeypot: hidden from people and screen readers. */}
              <input
                ref={honeypot}
                type='text'
                name='website'
                tabIndex={-1}
                autoComplete='off'
                aria-hidden
                className='absolute left-[-10000px] h-0 w-0 opacity-0'
              />
              {captcha && <TurnstileWidget ref={widget} onToken={setToken} />}
            </>
          }
        />
        <p className={cn('mt-5 flex items-center justify-center gap-1.5 text-xs', theme.muted)}>
          <Icons.lock className='size-3.5' aria-hidden />
          {t('securedBy')}
          <a
            href='https://levelup-ecosystem.com'
            target='_blank'
            rel='noopener noreferrer'
            className='font-medium underline-offset-2 hover:underline'
          >
            LevelUp
          </a>
        </p>
      </div>
    </main>
  );
}

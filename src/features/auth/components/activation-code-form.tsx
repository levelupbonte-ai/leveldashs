'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';
import { Icons } from '@/components/icons';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import { formatActivationCode, normalizeActivationCode } from '@/lib/access/codes';
import { setActiveWebsite } from '@/lib/auth/actions';
import { useAppForm } from '@/lib/form';

type Outcome =
  | 'invalid'
  | 'expired'
  | 'already_member'
  | 'rate_limited'
  | 'email_unconfirmed'
  | 'failed';

const MESSAGE = {
  invalid: 'invalid',
  expired: 'expired',
  already_member: 'alreadyMember',
  rate_limited: 'rateLimited',
  email_unconfirmed: 'unconfirmed',
  failed: 'failed'
} as const satisfies Record<Outcome, string>;

/** The one-time activation code form (a code like LVL-XXXX-XXXX-XXXX). */
export function ActivationCodeForm({
  email,
  initialOutcome = null
}: {
  email: string;
  /** Screenshot harness only. */
  initialOutcome?: Outcome | 'activated' | null;
}) {
  const t = useTranslations('auth.activate');
  const router = useRouter();
  const [outcome, setOutcome] = useState<Outcome | 'activated' | null>(initialOutcome);
  const schema = useMemo(
    () =>
      z.object({
        code: z
          .string()
          .max(64)
          .refine((v) => normalizeActivationCode(v) !== null, { message: t('formatInvalid') })
      }),
    [t]
  );

  const form = useAppForm({
    defaultValues: { code: '' },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      setOutcome(null);
      const body = normalizeActivationCode(value.code);
      if (!body) return;
      const res = await fetch('/api/access/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: formatActivationCode(body) })
      }).catch(() => null);
      const json = (res ? await res.json().catch(() => ({})) : {}) as {
        status?: string;
        error?: string;
        websiteId?: string | null;
        websiteName?: string | null;
      };
      if (!res || !res.ok) {
        setOutcome(json.error === 'rateLimited' ? 'rate_limited' : 'failed');
        return;
      }
      if (json.status === 'activated') {
        setOutcome('activated');
        if (json.websiteId) await setActiveWebsite(json.websiteId).catch(() => undefined);
        toast.success(t('success', { site: json.websiteName ?? '' }));
        router.replace('/dashboard/site');
        router.refresh();
        return;
      }
      setOutcome((json.status as Outcome) in MESSAGE ? (json.status as Outcome) : 'failed');
    }
  });

  return (
    <form
      className='space-y-4'
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      {outcome === 'activated' && (
        <Alert className='border-emerald-600/30 bg-emerald-500/10'>
          <Icons.circleCheck className='text-emerald-600' />
          <AlertDescription>{t('activated')}</AlertDescription>
        </Alert>
      )}
      {outcome && outcome !== 'activated' && (
        <Alert variant={outcome === 'already_member' ? 'default' : 'destructive'} role='alert'>
          <Icons.alertCircle />
          <AlertDescription>{t(MESSAGE[outcome])}</AlertDescription>
        </Alert>
      )}
      <FieldGroup>
        <form.AppField
          name='code'
          children={(field) => (
            <field.TextField
              label={t('label')}
              placeholder='LVL-XXXX-XXXX-XXXX'
              autoComplete='one-time-code'
              autoCapitalize='characters'
              spellCheck={false}
              className='font-mono tracking-wider uppercase'
              description={t('formatHint')}
            />
          )}
        />
      </FieldGroup>
      <form.AppForm>
        <form.SubmitButton className='w-full'>{t('submit')}</form.SubmitButton>
      </form.AppForm>
      <p className='text-muted-foreground text-center text-xs break-all'>
        {t('signedInAs', { email })}
      </p>
      <Link
        href='/auth/pending'
        className={buttonVariants({ variant: 'ghost', className: 'text-muted-foreground w-full' })}
      >
        {t('back')}
      </Link>
    </form>
  );
}

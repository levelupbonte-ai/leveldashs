'use client';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';
import { BrandImageInput } from '@/components/brand-image-input';
import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import { isExternalNext } from '@/lib/auth/redirect';
import type { DashboardUser } from '@/lib/auth/types';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import { AuthSteps } from './auth-steps';

type Request = {
  status: 'pending' | 'approved' | 'rejected';
  businessName: string;
  website: string;
  phone: string;
  message: string;
};

export default function OnboardingFlow({
  user,
  destination,
  hasAccess,
  request,
  initialStep = 'profile'
}: {
  user: DashboardUser;
  destination: string;
  hasAccess: boolean;
  request: Request | null;
  /** `access` to edit a pending request straight away ("Edit request"). */
  initialStep?: 'profile' | 'access';
}) {
  const router = useRouter();
  const t = useTranslations('auth.onboarding');
  const tv = useTranslations('validation');
  const locale = useLocale();
  const profileSchema = useMemo(
    () =>
      z.object({
        fullName: z
          .string()
          .trim()
          .min(2, { message: tv('fullName') })
          .max(120)
      }),
    [tv]
  );
  const accessSchema = useMemo(
    () =>
      z.object({
        businessName: z
          .string()
          .trim()
          .min(2, { message: t('businessRequired') })
          .max(120),
        website: z.string().trim().max(200),
        phone: z.string().trim().max(40),
        message: z.string().trim().max(1000)
      }),
    [t]
  );
  const forOtherApp = isExternalNext(destination);
  const [step, setStep] = useState<'profile' | 'access'>(initialStep);
  const [avatar, setAvatar] = useState<string | null>(user.avatarUrl);

  function goTo(target: string) {
    if (isExternalNext(target)) window.location.assign(target);
    else {
      router.replace(target);
      router.refresh();
    }
  }

  async function saveAvatar(url: string | null) {
    const { error } = await createClient()
      .from('profiles')
      .update({ avatar_url: url })
      .eq('id', user.id);
    if (error) toast.error(t('saveFailed'));
    else setAvatar(url);
  }

  const profileForm = useAppForm({
    defaultValues: {
      fullName: user.fullName === user.email.split('@')[0] ? '' : user.fullName
    },
    validators: { onSubmit: profileSchema },
    onSubmit: async ({ value }) => {
      const db = createClient();
      const fullName = value.fullName.trim();
      const { error } = await db.from('profiles').update({ full_name: fullName }).eq('id', user.id);
      if (error) {
        toast.error(t('saveFailed'));
        return;
      }
      // The language in use is kept on the account for LevelUp's e-mails.
      await db.auth.updateUser({ data: { full_name: fullName, locale } });
      if (hasAccess) goTo(forOtherApp ? destination : destination || '/dashboard/site');
      else if (forOtherApp) goTo(destination);
      else setStep('access');
    }
  });

  const accessForm = useAppForm({
    defaultValues: {
      businessName: request?.businessName ?? '',
      website: request?.website ?? '',
      phone: request?.phone ?? '',
      message: request?.message ?? ''
    },
    validators: { onSubmit: accessSchema },
    onSubmit: async ({ value }) => {
      const res = await fetch('/api/access/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value)
      });
      const body = (await res.json().catch(() => ({}))) as {
        status?: string;
        error?: string;
      };
      if (!res.ok) {
        toast.error(body.error === 'unverified' ? t('unverified') : t('sendFailed'));
        return;
      }
      if (body.status === 'member') return goTo('/dashboard/site');
      // Submitted: the dedicated "being reviewed" page takes over.
      goTo('/auth/pending');
    }
  });

  if (step === 'access') {
    return (
      <form
        className='space-y-4'
        onSubmit={(e) => {
          e.preventDefault();
          accessForm.handleSubmit();
        }}
      >
        <AuthSteps current={3} />
        {request?.status === 'pending' && (
          <p className='bg-muted/50 text-muted-foreground rounded-lg border p-3 text-xs'>
            {t('alreadyPending')}
          </p>
        )}
        <p className='text-muted-foreground text-sm'>{t('accessIntro')}</p>
        <FieldGroup>
          <accessForm.AppField
            name='businessName'
            children={(field) => (
              <field.TextField label={t('business')} autoComplete='organization' />
            )}
          />
          <accessForm.AppField
            name='website'
            children={(field) => (
              <field.TextField label={t('website')} placeholder='https://' autoComplete='url' />
            )}
          />
          <accessForm.AppField
            name='phone'
            children={(field) => (
              <field.TextField label={t('phone')} type='tel' autoComplete='tel' />
            )}
          />
          <accessForm.AppField
            name='message'
            children={(field) => <field.TextareaField label={t('project')} />}
          />
        </FieldGroup>
        <accessForm.AppForm>
          <accessForm.SubmitButton className='w-full'>
            {request?.status === 'pending' ? t('update') : t('requestAccess')}
          </accessForm.SubmitButton>
        </accessForm.AppForm>
        {request?.status === 'pending' && (
          <Button
            type='button'
            variant='ghost'
            className='w-full'
            onClick={() => goTo('/auth/pending')}
          >
            {t('cancel')}
          </Button>
        )}
      </form>
    );
  }

  return (
    <form
      className='space-y-5'
      onSubmit={(e) => {
        e.preventDefault();
        profileForm.handleSubmit();
      }}
    >
      {!hasAccess && !forOtherApp && <AuthSteps current={2} />}
      <BrandImageInput
        value={avatar}
        onChange={saveAvatar}
        folder={`avatars/${user.id}`}
        label={t('photo')}
        fallback={user.fullName || user.email}
      />
      <FieldGroup>
        <profileForm.AppField
          name='fullName'
          children={(field) => <field.TextField label={t('fullName')} autoComplete='name' />}
        />
      </FieldGroup>
      <profileForm.AppForm>
        <profileForm.SubmitButton className='w-full'>
          {hasAccess || forOtherApp ? t('finish') : t('continue')}
        </profileForm.SubmitButton>
      </profileForm.AppForm>
      <p className='text-muted-foreground text-center text-xs'>
        {t('signedInAs', { email: user.email })}{' '}
        <button
          type='button'
          className='underline underline-offset-4'
          onClick={async () => {
            await createClient().auth.signOut();
            goTo('/auth/sign-in');
          }}
        >
          {t('switchAccount')}
        </button>
      </p>
    </form>
  );
}

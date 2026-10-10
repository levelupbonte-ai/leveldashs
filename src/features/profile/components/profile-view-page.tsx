'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
import { Icons } from '@/components/icons';
import { LoadingButton } from '@/components/ui/loading-button';
import { useDashboardSession } from '@/lib/auth/session-context';
import { commonPasswordValidator } from '@/lib/auth/password-check';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';
import { BrandImageInput } from '@/components/brand-image-input';
import { hasRole } from '@/lib/auth/types';
import { PasskeysCard } from './passkeys-card';
import { SecuritySection } from './security-section';

export default function ProfileViewPage({
  passwordReset,
  passkeyEnabled = false
}: {
  passwordReset?: boolean;
  /** Passkeys turned on in Supabase Auth (live settings). */
  passkeyEnabled?: boolean;
}) {
  const { user, activeOrg, isPlatformAdmin } = useDashboardSession();
  const router = useRouter();
  const t = useTranslations('profile');
  const tv = useTranslations('validation');
  const { nameSchema, passwordSchema } = useMemo(
    () => ({
      nameSchema: z.object({
        fullName: z
          .string()
          .trim()
          .min(2, { message: tv('fullName') })
          .max(120)
      }),
      passwordSchema: z
        .object({
          password: z
            .string()
            .min(10, { message: tv('passwordMin', { min: 10 }) })
            .max(72, { message: tv('passwordMax', { max: 72 }) }),
          confirm: z.string()
        })
        .refine((v) => v.password === v.confirm, {
          message: tv('passwordsMatch'),
          path: ['confirm']
        })
    }),
    [tv]
  );
  const canBrandOrg = !!activeOrg && (isPlatformAdmin || hasRole(activeOrg.role, 'admin'));

  async function saveAvatar(url: string | null) {
    const db = createClient();
    const { error } = await db.from('profiles').update({ avatar_url: url }).eq('id', user.id);
    if (error) {
      toast.error(t('saveFailed'));
      return;
    }
    toast.success(url ? t('photoUpdated') : t('photoRemoved'));
    router.refresh();
  }

  async function saveLogo(url: string | null) {
    if (!activeOrg) return;
    const { error } = await createClient()
      .from('organizations')
      .update({ logo_url: url })
      .eq('id', activeOrg.id);
    if (error) {
      toast.error(t('saveFailed'));
      return;
    }
    toast.success(url ? t('logoUpdated') : t('logoRemoved'));
    router.refresh();
  }

  const nameForm = useAppForm({
    defaultValues: { fullName: user.fullName },
    validators: { onSubmit: nameSchema },
    onSubmit: async ({ value }) => {
      const db = createClient();
      const fullName = value.fullName.trim();
      const { error } = await db.from('profiles').update({ full_name: fullName }).eq('id', user.id);
      if (error) {
        toast.error(t('saveFailed'));
        return;
      }
      await db.auth.updateUser({ data: { full_name: fullName } });
      toast.success(t('profileUpdated'));
      router.refresh();
    }
  });

  const passwordForm = useAppForm({
    defaultValues: { password: '', confirm: '' },
    validators: {
      onSubmit: passwordSchema,
      onSubmitAsync: commonPasswordValidator(tv('commonPassword'))
    },
    onSubmit: async ({ value, formApi }) => {
      const { error } = await createClient().auth.updateUser({
        password: value.password
      });
      if (error) {
        toast.error(
          error.code === 'same_password'
            ? t('samePassword')
            : error.code === 'weak_password'
              ? t('weakPassword')
              : t('passwordFailed')
        );
        return;
      }
      formApi.reset();
      toast.success(t('passwordChanged'));
    }
  });

  return (
    <div className='grid grid-cols-1 max-w-4xl gap-6 lg:grid-cols-2'>
      {passwordReset && (
        <Alert className='lg:col-span-2'>
          <Icons.lock className='size-4' />
          <AlertDescription>{t('resetHint')}</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle>{t('info')}</CardTitle>
          <CardDescription>{user.email}</CardDescription>
        </CardHeader>
        <CardContent className='space-y-6'>
          <BrandImageInput
            value={user.avatarUrl}
            onChange={saveAvatar}
            folder={`avatars/${user.id}`}
            label={t('photo')}
            fallback={user.fullName || user.email}
          />
          <form
            className='space-y-4'
            onSubmit={(e) => {
              e.preventDefault();
              nameForm.handleSubmit();
            }}
          >
            <FieldGroup>
              <nameForm.AppField
                name='fullName'
                children={(field) => <field.TextField label={t('fullName')} autoComplete='name' />}
              />
            </FieldGroup>
            <nameForm.Subscribe
              selector={(s) => s.isSubmitting}
              children={(submitting) => (
                <LoadingButton type='submit' loading={submitting}>
                  {t('save')}
                </LoadingButton>
              )}
            />
          </form>
        </CardContent>
      </Card>
      {canBrandOrg && activeOrg && (
        <Card>
          <CardHeader>
            <CardTitle>{t('logoTitle', { name: activeOrg.name })}</CardTitle>
            <CardDescription>{t('logoDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <BrandImageInput
              value={activeOrg.logoUrl}
              onChange={saveLogo}
              folder={`orgs/${activeOrg.id}`}
              label={t('logo')}
              fallback={activeOrg.name}
              rounded='lg'
            />
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>{t('password')}</CardTitle>
          <CardDescription>{t('passwordHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className='space-y-4'
            onSubmit={(e) => {
              e.preventDefault();
              passwordForm.handleSubmit();
            }}
          >
            <FieldGroup>
              <passwordForm.AppField
                name='password'
                children={(field) => (
                  <field.TextField
                    label={t('newPassword')}
                    type='password'
                    autoComplete='new-password'
                  />
                )}
              />
              <passwordForm.AppField
                name='confirm'
                children={(field) => (
                  <field.TextField
                    label={t('confirm')}
                    type='password'
                    autoComplete='new-password'
                  />
                )}
              />
            </FieldGroup>
            <passwordForm.Subscribe
              selector={(s) => s.isSubmitting}
              children={(submitting) => (
                <LoadingButton type='submit' loading={submitting}>
                  {t('changePassword')}
                </LoadingButton>
              )}
            />
          </form>
        </CardContent>
      </Card>
      <div id='security' className='grid scroll-mt-20 gap-6 lg:col-span-2'>
        <SecuritySection />
        {passkeyEnabled && <PasskeysCard />}
      </div>
    </div>
  );
}

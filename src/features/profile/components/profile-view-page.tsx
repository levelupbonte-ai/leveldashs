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
import { toast } from 'sonner';
import * as z from 'zod';
import { BrandImageInput } from '@/components/brand-image-input';
import { hasRole } from '@/lib/auth/types';
import { PasskeysCard } from './passkeys-card';
import { SecuritySection } from './security-section';

const nameSchema = z.object({
  fullName: z.string().trim().min(2, { message: 'Votre nom' }).max(120)
});

const passwordSchema = z
  .object({
    password: z.string().min(10, { message: '10 caractères minimum' }).max(72),
    confirm: z.string()
  })
  .refine((v) => v.password === v.confirm, {
    message: 'Les mots de passe ne correspondent pas',
    path: ['confirm']
  });

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
  const canBrandOrg = !!activeOrg && (isPlatformAdmin || hasRole(activeOrg.role, 'admin'));

  async function saveAvatar(url: string | null) {
    const db = createClient();
    const { error } = await db.from('profiles').update({ avatar_url: url }).eq('id', user.id);
    if (error) {
      toast.error('Enregistrement impossible.');
      return;
    }
    toast.success(url ? 'Photo mise à jour' : 'Photo retirée');
    router.refresh();
  }

  async function saveLogo(url: string | null) {
    if (!activeOrg) return;
    const { error } = await createClient()
      .from('organizations')
      .update({ logo_url: url })
      .eq('id', activeOrg.id);
    if (error) {
      toast.error('Enregistrement impossible.');
      return;
    }
    toast.success(url ? 'Logo mis à jour' : 'Logo retiré');
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
        toast.error('Enregistrement impossible.');
        return;
      }
      await db.auth.updateUser({ data: { full_name: fullName } });
      toast.success('Profil mis à jour');
      router.refresh();
    }
  });

  const passwordForm = useAppForm({
    defaultValues: { password: '', confirm: '' },
    validators: {
      onSubmit: passwordSchema,
      onSubmitAsync: commonPasswordValidator
    },
    onSubmit: async ({ value, formApi }) => {
      const { error } = await createClient().auth.updateUser({
        password: value.password
      });
      if (error) {
        toast.error(
          error.code === 'same_password'
            ? 'Choisissez un mot de passe différent de l’actuel.'
            : error.code === 'weak_password'
              ? 'Mot de passe trop faible.'
              : 'Modification impossible. Reconnectez-vous puis réessayez.'
        );
        return;
      }
      formApi.reset();
      toast.success('Mot de passe modifié');
    }
  });

  return (
    <div className='grid max-w-4xl gap-6 lg:grid-cols-2'>
      {passwordReset && (
        <Alert className='lg:col-span-2'>
          <Icons.lock className='size-4' />
          <AlertDescription>Choisissez votre nouveau mot de passe ci-dessous.</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Informations</CardTitle>
          <CardDescription>{user.email}</CardDescription>
        </CardHeader>
        <CardContent className='space-y-6'>
          <BrandImageInput
            value={user.avatarUrl}
            onChange={saveAvatar}
            folder={`avatars/${user.id}`}
            label='Photo de profil'
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
                children={(field) => <field.TextField label='Nom complet' autoComplete='name' />}
              />
            </FieldGroup>
            <nameForm.Subscribe
              selector={(s) => s.isSubmitting}
              children={(submitting) => (
                <LoadingButton type='submit' loading={submitting}>
                  Enregistrer
                </LoadingButton>
              )}
            />
          </form>
        </CardContent>
      </Card>
      {canBrandOrg && activeOrg && (
        <Card>
          <CardHeader>
            <CardTitle>Logo de {activeOrg.name}</CardTitle>
            <CardDescription>
              Affiché en haut du tableau de bord pour toute votre équipe.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BrandImageInput
              value={activeOrg.logoUrl}
              onChange={saveLogo}
              folder={`orgs/${activeOrg.id}`}
              label='Logo'
              fallback={activeOrg.name}
              rounded='lg'
            />
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Mot de passe</CardTitle>
          <CardDescription>10 caractères minimum.</CardDescription>
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
                    label='Nouveau mot de passe'
                    type='password'
                    autoComplete='new-password'
                  />
                )}
              />
              <passwordForm.AppField
                name='confirm'
                children={(field) => (
                  <field.TextField label='Confirmer' type='password' autoComplete='new-password' />
                )}
              />
            </FieldGroup>
            <passwordForm.Subscribe
              selector={(s) => s.isSubmitting}
              children={(submitting) => (
                <LoadingButton type='submit' loading={submitting}>
                  Changer le mot de passe
                </LoadingButton>
              )}
            />
          </form>
        </CardContent>
      </Card>
      <div id='securite' className='grid scroll-mt-20 gap-6 lg:col-span-2'>
        <SecuritySection />
        {passkeyEnabled && <PasskeysCard />}
      </div>
    </div>
  );
}

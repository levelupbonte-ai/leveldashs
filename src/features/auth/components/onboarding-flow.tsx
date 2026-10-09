'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';
import { BrandImageInput } from '@/components/brand-image-input';
import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import { isExternalNext } from '@/lib/auth/redirect';
import type { DashboardUser } from '@/lib/auth/types';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import { MfaSuggestion, PasskeySuggestion } from './account-suggestions';
import { AuthSteps } from './auth-steps';

type Request = {
  status: 'pending' | 'approved' | 'rejected';
  businessName: string;
  website: string;
  phone: string;
  message: string;
};

const profileSchema = z.object({
  fullName: z.string().trim().min(2, { message: 'Votre nom' }).max(120)
});
const accessSchema = z.object({
  businessName: z.string().trim().min(2, { message: 'Le nom de votre entreprise' }).max(120),
  website: z.string().trim().max(200),
  phone: z.string().trim().max(40),
  message: z.string().trim().max(1000)
});

export default function OnboardingFlow({
  user,
  destination,
  hasAccess,
  mfaEnabled,
  passkeyEnabled = false,
  request,
  initialStep = 'profile'
}: {
  user: DashboardUser;
  destination: string;
  hasAccess: boolean;
  mfaEnabled: boolean;
  /** Passkeys turned on in Supabase Auth (live settings). */
  passkeyEnabled?: boolean;
  request: Request | null;
  /** `access` to edit a pending request straight away ("Modifier ma demande"). */
  initialStep?: 'profile' | 'access';
}) {
  const router = useRouter();
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
    if (error) toast.error('Enregistrement impossible.');
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
        toast.error('Enregistrement impossible.');
        return;
      }
      await db.auth.updateUser({ data: { full_name: fullName } });
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
        toast.error(
          body.error === 'unverified'
            ? 'Confirmez d’abord votre adresse e-mail.'
            : 'Envoi impossible.'
        );
        return;
      }
      if (body.status === 'member') return goTo('/dashboard/site');
      // Submitted: the dedicated "en cours de vérification" page takes over.
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
          <p className='rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-900 dark:text-amber-200'>
            Votre demande est déjà en cours de vérification : vos modifications la mettent à jour,
            sans repartir de zéro.
          </p>
        )}
        <p className='text-muted-foreground text-sm'>
          Le tableau de bord est réservé aux clients LevelUp. Présentez votre activité : nous
          validons votre accès rapidement.
        </p>
        <FieldGroup>
          <accessForm.AppField
            name='businessName'
            children={(field) => <field.TextField label='Entreprise' autoComplete='organization' />}
          />
          <accessForm.AppField
            name='website'
            children={(field) => (
              <field.TextField
                label='Site actuel (facultatif)'
                placeholder='https://'
                autoComplete='url'
              />
            )}
          />
          <accessForm.AppField
            name='phone'
            children={(field) => (
              <field.TextField label='Téléphone (facultatif)' type='tel' autoComplete='tel' />
            )}
          />
          <accessForm.AppField
            name='message'
            children={(field) => <field.TextareaField label='Votre projet (facultatif)' />}
          />
        </FieldGroup>
        <accessForm.AppForm>
          <accessForm.SubmitButton className='w-full'>
            {request?.status === 'pending' ? 'Mettre à jour ma demande' : 'Demander l’accès'}
          </accessForm.SubmitButton>
        </accessForm.AppForm>
        {request?.status === 'pending' && (
          <Button
            type='button'
            variant='ghost'
            className='w-full'
            onClick={() => goTo('/auth/pending')}
          >
            Annuler
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
        label='Photo ou logo (facultatif)'
        fallback={user.fullName || user.email}
      />
      <FieldGroup>
        <profileForm.AppField
          name='fullName'
          children={(field) => <field.TextField label='Nom complet' autoComplete='name' />}
        />
      </FieldGroup>
      <profileForm.AppForm>
        <profileForm.SubmitButton className='w-full'>
          {hasAccess || forOtherApp ? 'Terminer' : 'Continuer'}
        </profileForm.SubmitButton>
      </profileForm.AppForm>
      {!mfaEnabled && !forOtherApp && <MfaSuggestion canOpenDashboard={hasAccess} />}
      {passkeyEnabled && !forOtherApp && <PasskeySuggestion canOpenDashboard={hasAccess} />}
      <p className='text-muted-foreground text-center text-xs'>
        Connecté en tant que {user.email}.{' '}
        <button
          type='button'
          className='underline underline-offset-4'
          onClick={async () => {
            await createClient().auth.signOut();
            goTo('/auth/sign-in');
          }}
        >
          Changer de compte
        </button>
      </p>
    </form>
  );
}

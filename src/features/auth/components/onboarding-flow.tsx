'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';
import { BrandImageInput } from '@/components/brand-image-input';
import { Icons } from '@/components/icons';
import { Button, buttonVariants } from '@/components/ui/button';
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

const profileSchema = z.object({
  fullName: z.string().trim().min(2, { message: 'Votre nom' }).max(120)
});
const accessSchema = z.object({
  businessName: z.string().trim().min(2, { message: 'Le nom de votre entreprise' }).max(120),
  website: z.string().trim().max(200),
  phone: z.string().trim().max(40),
  message: z.string().trim().max(1000)
});

/**
 * Nudge towards the authenticator app (TOTP). Approved members get a direct link
 * to Profil → Sécurité; others are told where to find it once access opens.
 */
function MfaSuggestion({ canOpenDashboard }: { canOpenDashboard: boolean }) {
  return (
    <div className='flex gap-3 rounded-lg border border-violet-500/25 bg-violet-500/5 p-3 text-left text-xs'>
      <Icons.shield className='mt-0.5 size-4 shrink-0 text-violet-500' aria-hidden />
      <div className='space-y-1'>
        <p className='text-foreground font-medium'>Protégez votre compte</p>
        <p className='text-muted-foreground'>
          Activez la double authentification avec une application (Google Authenticator, 1Password…)
          : un code à 6 chiffres vous sera demandé à chaque connexion.
        </p>
        {canOpenDashboard ? (
          <Link
            href='/dashboard/profile#securite'
            className='text-primary font-medium underline underline-offset-4'
          >
            Activer l’application d’authentification
          </Link>
        ) : (
          <p className='text-muted-foreground'>
            Dès que votre accès est validé : Profil → Sécurité.
          </p>
        )}
      </div>
    </div>
  );
}

/** One line pointing to Profil → Sécurité once passkeys are enabled in Supabase. */
function PasskeySuggestion({ canOpenDashboard }: { canOpenDashboard: boolean }) {
  return (
    <p className='text-muted-foreground flex items-start gap-2 text-left text-xs'>
      <Icons.passkey className='mt-0.5 size-4 shrink-0' aria-hidden />
      <span>
        Connectez-vous plus vite avec une passkey (Face ID, Touch ID, Windows Hello) :{' '}
        {canOpenDashboard ? (
          <Link
            href='/dashboard/profile#securite'
            className='text-primary font-medium underline underline-offset-4'
          >
            Profil → Sécurité
          </Link>
        ) : (
          'Profil → Sécurité, dès que votre accès est validé'
        )}
        .
      </span>
    </p>
  );
}

function PendingScreen({
  businessName,
  onEdit,
  mfaEnabled,
  passkeyEnabled
}: {
  businessName: string;
  onEdit: () => void;
  mfaEnabled: boolean;
  passkeyEnabled: boolean;
}) {
  return (
    <div className='space-y-5' role='status'>
      <AuthSteps current={3} />
      <div className='bg-muted mx-auto grid size-12 place-items-center rounded-full'>
        <Icons.hourglass className='size-6' aria-hidden />
      </div>
      <div className='space-y-2 text-center text-sm'>
        <p>
          Votre demande pour <strong>{businessName}</strong> a bien été envoyée.
        </p>
        <p className='text-muted-foreground'>
          Nous vérifions chaque compte avant d’ouvrir le tableau de bord, en général sous 24 h
          ouvrées. Vous recevrez un e-mail dès que c’est validé.
        </p>
      </div>
      <div className='grid gap-2'>
        <a
          href='https://studio.levelup-ecosystem.com'
          className={buttonVariants({ variant: 'outline' })}
        >
          En attendant, essayer LevelStudio
        </a>
        <Button variant='ghost' onClick={onEdit}>
          Modifier ma demande
        </Button>
      </div>
      {!mfaEnabled && <MfaSuggestion canOpenDashboard={false} />}
      {passkeyEnabled && <PasskeySuggestion canOpenDashboard={false} />}
    </div>
  );
}

export default function OnboardingFlow({
  user,
  destination,
  hasAccess,
  mfaEnabled,
  passkeyEnabled = false,
  request
}: {
  user: DashboardUser;
  destination: string;
  hasAccess: boolean;
  mfaEnabled: boolean;
  /** Passkeys turned on in Supabase Auth (live settings). */
  passkeyEnabled?: boolean;
  request: Request | null;
}) {
  const router = useRouter();
  const forOtherApp = isExternalNext(destination);
  const [step, setStep] = useState<'profile' | 'access' | 'pending'>(
    request?.status === 'pending' ? 'pending' : 'profile'
  );
  const [avatar, setAvatar] = useState<string | null>(user.avatarUrl);
  const [business, setBusiness] = useState(request?.businessName ?? '');

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
      setBusiness(value.businessName.trim());
      setStep('pending');
      router.refresh();
    }
  });

  if (request?.status === 'rejected' && !hasAccess) {
    return (
      <div className='space-y-4 text-center text-sm'>
        <p className='text-muted-foreground'>
          Pour toute question ou pour créer votre site avec LevelUp, écrivez-nous à{' '}
          <a href='mailto:contact@levelup-ecosystem.com' className='underline underline-offset-4'>
            contact@levelup-ecosystem.com
          </a>
          .
        </p>
        <a
          href='https://studio.levelup-ecosystem.com'
          className={buttonVariants({
            variant: 'outline',
            className: 'w-full'
          })}
        >
          Continuer vers LevelStudio
        </a>
      </div>
    );
  }

  if (step === 'pending')
    return (
      <PendingScreen
        businessName={business}
        onEdit={() => setStep('access')}
        mfaEnabled={mfaEnabled}
        passkeyEnabled={passkeyEnabled}
      />
    );

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
          <accessForm.SubmitButton className='w-full'>Demander l’accès</accessForm.SubmitButton>
        </accessForm.AppForm>
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

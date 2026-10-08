'use client';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import { LoadingButton } from '@/components/ui/loading-button';
import { safeNext } from '@/lib/auth/redirect';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';

const signInSchema = z.object({
  fullName: z.string(),
  email: z.string().email({ message: 'Adresse e-mail invalide' }),
  password: z.string().min(1, { message: 'Mot de passe requis' })
});

const signUpSchema = signInSchema.extend({
  fullName: z.string().trim().min(2, { message: 'Votre nom' }).max(120),
  password: z
    .string()
    .min(10, { message: '10 caractères minimum' })
    .max(72, { message: '72 caractères maximum' })
});

function callbackUrl(next: string) {
  return `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
}

export default function UserAuthForm({
  mode,
  next,
  initialError
}: {
  mode: 'sign-in' | 'sign-up';
  next?: string;
  initialError?: string;
}) {
  const router = useRouter();
  const destination = safeNext(next);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(
    initialError ? 'La connexion a échoué. Réessayez.' : null
  );

  const form = useAppForm({
    defaultValues: { fullName: '', email: '', password: '' },
    validators: { onSubmit: mode === 'sign-up' ? signUpSchema : signInSchema },
    onSubmit: async ({ value }) => {
      setPending(true);
      setNotice(null);
      const supabase = createClient();
      try {
        if (mode === 'sign-in') {
          const { error } = await supabase.auth.signInWithPassword({
            email: value.email,
            password: value.password
          });
          if (error) {
            setNotice(
              error.code === 'email_not_confirmed'
                ? 'Confirmez votre adresse e-mail (lien reçu par e-mail) puis reconnectez-vous.'
                : 'E-mail ou mot de passe incorrect.'
            );
            return;
          }
          router.replace(destination);
          router.refresh();
        } else {
          const { data, error } = await supabase.auth.signUp({
            email: value.email,
            password: value.password,
            options: {
              data: { full_name: value.fullName.trim() },
              emailRedirectTo: callbackUrl(destination)
            }
          });
          if (error) {
            setNotice(
              error.code === 'weak_password'
                ? 'Mot de passe trop faible : choisissez-en un plus long.'
                : 'Inscription impossible. Vérifiez vos informations.'
            );
            return;
          }
          if (data.session) {
            router.replace(destination);
            router.refresh();
          } else {
            setNotice('Presque fini : cliquez sur le lien envoyé à votre adresse e-mail.');
          }
        }
      } finally {
        setPending(false);
      }
    }
  });

  async function signInWithGoogle() {
    setPending(true);
    const { error } = await createClient().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: callbackUrl(destination) }
    });
    if (error) {
      setPending(false);
      toast.error('Connexion Google indisponible pour le moment.');
    }
  }

  async function resetPassword() {
    const email = form.getFieldValue('email');
    if (!z.string().email().safeParse(email).success) {
      setNotice('Entrez votre e-mail ci-dessus, puis cliquez sur « Mot de passe oublié ».');
      return;
    }
    setPending(true);
    await createClient().auth.resetPasswordForEmail(email, {
      redirectTo: callbackUrl('/dashboard/profile?reset=1')
    });
    setPending(false);
    // Same message whether or not the account exists.
    setNotice('Si un compte existe pour cet e-mail, un lien de réinitialisation a été envoyé.');
  }

  return (
    <div className='space-y-4'>
      <Button
        className='w-full'
        variant='outline'
        type='button'
        disabled={pending}
        onClick={signInWithGoogle}
      >
        <Icons.google className='mr-2 h-4 w-4' />
        Continuer avec Google
      </Button>
      <div className='relative'>
        <div className='absolute inset-0 flex items-center'>
          <span className='w-full border-t' />
        </div>
        <div className='relative flex justify-center text-xs uppercase'>
          <span className='bg-background text-muted-foreground px-2'>ou par e-mail</span>
        </div>
      </div>
      <form
        className='w-full space-y-2'
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit();
        }}
      >
        <FieldGroup>
          {mode === 'sign-up' && (
            <form.AppField
              name='fullName'
              children={(field) => (
                <field.TextField label='Nom complet' autoComplete='name' disabled={pending} />
              )}
            />
          )}
          <form.AppField
            name='email'
            children={(field) => (
              <field.TextField
                label='E-mail'
                type='email'
                autoComplete='email'
                placeholder='vous@exemple.com'
                disabled={pending}
              />
            )}
          />
          <form.AppField
            name='password'
            children={(field) => (
              <field.TextField
                label='Mot de passe'
                type='password'
                autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
                disabled={pending}
              />
            )}
          />
        </FieldGroup>
        {notice && (
          <p role='status' className='text-muted-foreground text-sm'>
            {notice}
          </p>
        )}
        <LoadingButton loading={pending} type='submit' className='mt-2 w-full'>
          {mode === 'sign-in' ? 'Se connecter' : 'Créer mon compte'}
        </LoadingButton>
        {mode === 'sign-in' && (
          <Button
            type='button'
            variant='link'
            className='text-muted-foreground w-full'
            disabled={pending}
            onClick={resetPassword}
          >
            Mot de passe oublié ?
          </Button>
        )}
      </form>
    </div>
  );
}

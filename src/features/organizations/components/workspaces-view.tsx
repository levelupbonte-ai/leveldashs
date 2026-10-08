'use client';

import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
import { LoadingButton } from '@/components/ui/loading-button';
import { setActiveOrganization } from '@/lib/auth/actions';
import { useDashboardSession } from '@/lib/auth/session-context';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import { slugify } from '@/features/site/api/service';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';
import { createOrganization } from '../api/service';

const ROLE_LABEL: Record<string, string> = {
  owner: 'Propriétaire',
  admin: 'Administrateur',
  editor: 'Éditeur',
  viewer: 'Lecture seule'
};

const createSchema = z.object({
  name: z.string().trim().min(2, { message: 'Nom requis' }).max(120)
});

export function WorkspacesView() {
  const { organizations, activeOrg } = useDashboardSession();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const open = (id: string, href = '/dashboard/site') =>
    startTransition(async () => {
      await setActiveOrganization(id);
      router.push(href);
      router.refresh();
    });

  const form = useAppForm({
    defaultValues: { name: '' },
    validators: { onSubmit: createSchema },
    onSubmit: async ({ value }) => {
      try {
        const slug = `${slugify(value.name).slice(0, 40)}-${Math.random().toString(36).slice(2, 6)}`;
        const org = await createOrganization(createClient(), value.name.trim(), slug);
        toast.success('Organisation créée');
        open(org.id, '/dashboard/workspaces/team');
      } catch (e) {
        toast.error((e as Error).message);
      }
    }
  });

  return (
    <div className='grid gap-6 lg:grid-cols-[1fr_360px]'>
      <div className='space-y-3'>
        {organizations.length === 0 && (
          <p className='text-muted-foreground text-sm'>
            Vous n’êtes membre d’aucune organisation. Si LevelUp gère votre site, demandez-nous de
            vous y ajouter avec l’e-mail de ce compte.
          </p>
        )}
        {organizations.map((org) => (
          <Card key={org.id}>
            <CardContent className='flex items-center gap-3'>
              <div className='bg-muted flex size-10 items-center justify-center rounded-lg'>
                <Icons.galleryVerticalEnd className='size-5' />
              </div>
              <div className='min-w-0 flex-1'>
                <p className='truncate font-medium'>{org.name}</p>
                <p className='text-muted-foreground text-xs'>
                  {org.role ? ROLE_LABEL[org.role] : 'Accès LevelUp admin'}
                </p>
              </div>
              {org.id === activeOrg?.id ? (
                <Badge>Active</Badge>
              ) : (
                <Button size='sm' variant='outline' disabled={pending} onClick={() => open(org.id)}>
                  Ouvrir
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className='h-fit'>
        <CardHeader>
          <CardTitle>Nouvelle organisation</CardTitle>
          <CardDescription>
            Pour votre entreprise. Le site y est relié ensuite par l’équipe LevelUp.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className='space-y-4'
            onSubmit={(e) => {
              e.preventDefault();
              form.handleSubmit();
            }}
          >
            <FieldGroup>
              <form.AppField
                name='name'
                children={(field) => <field.TextField label='Nom' placeholder='Mon entreprise' />}
              />
            </FieldGroup>
            <form.Subscribe
              selector={(s) => s.isSubmitting}
              children={(submitting) => (
                <LoadingButton type='submit' loading={submitting || pending} className='w-full'>
                  Créer
                </LoadingButton>
              )}
            />
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

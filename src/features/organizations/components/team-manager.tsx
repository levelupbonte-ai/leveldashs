'use client';

import { Icons } from '@/components/icons';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
import { LoadingButton } from '@/components/ui/loading-button';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { useDashboardSession } from '@/lib/auth/session-context';
import { hasRole, type OrgRole } from '@/lib/auth/types';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import * as z from 'zod';
import { invitationsQueryOptions, membersQueryOptions, orgKeys } from '../api/queries';
import { addMember, cancelInvitation, removeMember, updateMemberRole } from '../api/service';

const ROLES: Record<OrgRole, string> = {
  owner: 'Propriétaire',
  admin: 'Administrateur',
  editor: 'Éditeur',
  viewer: 'Lecture seule'
};

const onError = (e: Error) => toast.error(e.message);

const inviteSchema = z.object({
  email: z.string().trim().email({ message: 'Adresse e-mail invalide' }),
  role: z.enum(['viewer', 'editor', 'admin', 'owner'])
});

export function TeamManager() {
  const { activeOrg, user, isPlatformAdmin } = useDashboardSession();
  const org = activeOrg!;
  const db = createClient();
  const queryClient = useQueryClient();
  const { data: members } = useSuspenseQuery(membersQueryOptions(db, org.id));
  const canManage = isPlatformAdmin || hasRole(org.role, 'admin');
  const isOwner = org.role === 'owner';
  const { data: invitations = [] } = useQuery({
    ...invitationsQueryOptions(db, org.id),
    enabled: canManage
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: orgKeys.members(org.id) });
    void queryClient.invalidateQueries({ queryKey: orgKeys.invitations(org.id) });
  };
  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelInvitation(db, id),
    onSuccess: () => {
      toast.success('Invitation annulée');
      refresh();
    },
    onError
  });

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: OrgRole }) =>
      updateMemberRole(db, org.id, userId, role),
    onSuccess: () => {
      toast.success('Rôle mis à jour');
      refresh();
    },
    onError
  });
  const removeMutation = useMutation({
    mutationFn: (userId: string) => removeMember(db, org.id, userId),
    onSuccess: () => {
      toast.success('Membre retiré');
      refresh();
    },
    onError
  });

  const form = useAppForm({
    defaultValues: { email: '', role: 'editor' as OrgRole },
    validators: { onSubmit: inviteSchema },
    onSubmit: async ({ value, formApi }) => {
      try {
        const result = await addMember(db, org.id, value.email, value.role);
        toast.success(
          result === 'invited'
            ? 'Invitation enregistrée : la personne rejoindra l’équipe en créant son compte avec cet e-mail.'
            : result === 'added'
              ? 'Membre ajouté'
              : 'Rôle mis à jour'
        );
        formApi.reset();
        refresh();
      } catch (e) {
        toast.error((e as Error).message);
      }
    }
  });

  const assignable = (Object.keys(ROLES) as OrgRole[]).filter((r) => r !== 'owner' || isOwner);

  return (
    <div className='grid gap-6 lg:grid-cols-[1fr_360px]'>
      <Card>
        <CardHeader>
          <CardTitle>Membres ({members.length})</CardTitle>
          <CardDescription>
            Propriétaire et administrateur gèrent l’équipe ; éditeur modifie le contenu ; lecture
            seule consulte.
          </CardDescription>
        </CardHeader>
        <CardContent className='divide-y'>
          {members.map((m) => {
            const editable = canManage && m.userId !== user.id && (m.role !== 'owner' || isOwner);
            return (
              <div key={m.userId} className='flex items-center gap-3 py-3'>
                <Avatar className='size-9'>
                  <AvatarImage src={m.avatarUrl ?? ''} alt='' />
                  <AvatarFallback>
                    {(m.fullName || m.email || '?').slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className='min-w-0 flex-1'>
                  <p className='truncate font-medium'>
                    {m.fullName || m.email || 'Membre'}
                    {m.userId === user.id && <span className='text-muted-foreground'> (vous)</span>}
                  </p>
                  <p className='text-muted-foreground truncate text-xs'>{m.email}</p>
                </div>
                {editable ? (
                  <>
                    <NativeSelect
                      aria-label='Rôle'
                      className='h-8 text-xs'
                      value={m.role}
                      onChange={(e) =>
                        roleMutation.mutate({ userId: m.userId, role: e.target.value as OrgRole })
                      }
                    >
                      {assignable.map((r) => (
                        <NativeSelectOption key={r} value={r}>
                          {ROLES[r]}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <Button
                      size='icon'
                      variant='ghost'
                      aria-label='Retirer'
                      onClick={() => {
                        if (
                          window.confirm(`Retirer ${m.fullName || m.email} de l’organisation ?`)
                        ) {
                          removeMutation.mutate(m.userId);
                        }
                      }}
                    >
                      <Icons.trash className='size-4' />
                    </Button>
                  </>
                ) : (
                  <span className='text-muted-foreground text-sm'>{ROLES[m.role]}</span>
                )}
              </div>
            );
          })}
          {invitations.map((inv) => (
            <div key={inv.id} className='flex items-center gap-3 py-3'>
              <div className='bg-muted flex size-9 items-center justify-center rounded-full'>
                <Icons.mail className='size-4' />
              </div>
              <div className='min-w-0 flex-1'>
                <p className='truncate font-medium'>{inv.email}</p>
                <p className='text-muted-foreground text-xs'>
                  Invitation en attente · {ROLES[inv.role]}
                </p>
              </div>
              <Button
                size='icon'
                variant='ghost'
                aria-label='Annuler l’invitation'
                onClick={() => cancelMutation.mutate(inv.id)}
              >
                <Icons.close className='size-4' />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {canManage && (
        <Card className='h-fit'>
          <CardHeader>
            <CardTitle>Ajouter un membre</CardTitle>
            <CardDescription>
              La personne doit d’abord avoir créé son compte LevelUp.
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
                  name='email'
                  children={(field) => <field.TextField label='E-mail' type='email' />}
                />
                <form.AppField
                  name='role'
                  children={(field) => (
                    <field.SelectField
                      label='Rôle'
                      options={assignable.map((r) => ({ value: r, label: ROLES[r] }))}
                    />
                  )}
                />
              </FieldGroup>
              <form.Subscribe
                selector={(s) => s.isSubmitting}
                children={(submitting) => (
                  <LoadingButton type='submit' loading={submitting} className='w-full'>
                    Ajouter
                  </LoadingButton>
                )}
              />
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

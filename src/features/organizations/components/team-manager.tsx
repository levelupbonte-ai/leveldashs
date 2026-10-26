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
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';
import { useFields } from '@/lib/validation/use-fields';
import { MfaStepNotice } from '@/components/mfa-step-notice';
import { useErrorMessage } from '@/hooks/use-error-message';
import { errorCode } from '@/lib/errors';
import { PlanLimitError, type PlanLimitInfo } from '@/lib/plan-limit';
import { PlanLimitNotice } from '@/features/billing/components/plan-limit-notice';
import { invitationsQueryOptions, membersQueryOptions, orgKeys } from '../api/queries';
import {
  inviteMember,
  removeMember,
  resendInvitation,
  revokeInvitation,
  updateMemberRole,
  type InviteResult
} from '../api/service';
import { InvitationList } from './invitation-list';

const ROLES: OrgRole[] = ['owner', 'admin', 'editor', 'viewer'];

export function TeamManager() {
  const { activeOrg, user, isPlatformAdmin } = useDashboardSession();
  const t = useTranslations('team');
  const tRole = useTranslations('common.roles');
  const errorMessage = useErrorMessage();
  // The database asked for two-step verification first: calm notice, not an error.
  const [mfaBlocked, setMfaBlocked] = useState(false);
  // The plan's seats are all used: upgrade notice with a link to Billing.
  const [planLimit, setPlanLimit] = useState<PlanLimitInfo | null>(null);
  const onError = (e: unknown) => {
    if (e instanceof PlanLimitError) setPlanLimit(e.info);
    else if (errorCode(e) === 'mfaRequired') setMfaBlocked(true);
    else toast.error(errorMessage(e));
  };
  const f = useFields();
  const inviteSchema = useMemo(
    () =>
      z.object({
        email: f.email({ required: true }),
        role: f.oneOf(['viewer', 'editor', 'admin', 'owner'])
      }),
    [f]
  );
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
  // Never claim an e-mail went out when Resend refused it: warn and offer a retry.
  const announce = (result: InviteResult, email: string) => {
    if (result.status === 'sent') {
      toast.success(t('invitationSent', { email }));
      return;
    }
    toast.error(t('inviteEmailFailed', { email }), {
      duration: 15000,
      action: {
        label: t('retry'),
        onClick: () => resendMutation.mutate({ id: result.invitationId, email })
      }
    });
  };
  const resendMutation = useMutation({
    mutationFn: ({ id }: { id: string; email: string }) => resendInvitation(id),
    onSuccess: (result, vars) => {
      announce(result, vars.email);
      refresh();
    },
    onError: (e) => {
      onError(e);
      refresh();
    }
  });
  const revokeMutation = useMutation({
    mutationFn: (id: string) => revokeInvitation(db, id),
    onSuccess: () => {
      toast.success(t('invitationRevoked'));
      refresh();
    },
    onError
  });

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: OrgRole }) =>
      updateMemberRole(db, org.id, userId, role),
    onSuccess: () => {
      toast.success(t('roleUpdated'));
      refresh();
    },
    onError
  });
  const removeMutation = useMutation({
    mutationFn: (userId: string) => removeMember(db, org.id, userId),
    onSuccess: () => {
      toast.success(t('memberRemoved'));
      refresh();
    },
    onError
  });

  const form = useAppForm({
    defaultValues: { email: '', role: 'editor' as OrgRole },
    validators: { onSubmit: inviteSchema },
    onSubmit: async ({ value, formApi }) => {
      try {
        const clean = inviteSchema.parse(value);
        const result = await inviteMember(org.id, clean.email, clean.role);
        announce(result, clean.email);
        formApi.reset();
        refresh();
      } catch (e) {
        onError(e);
      }
    }
  });

  const assignable = ROLES.filter((r) => r !== 'owner' || isOwner);

  return (
    <div className='grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]'>
      {mfaBlocked && <MfaStepNotice className='lg:col-span-2' />}
      {planLimit && <PlanLimitNotice info={planLimit} className='lg:col-span-2' />}
      <Card>
        <CardHeader>
          <CardTitle>{t('members', { count: members.length })}</CardTitle>
          <CardDescription>{t('membersDescription')}</CardDescription>
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
                    {m.fullName || m.email || t('member')}
                    {m.userId === user.id && (
                      <span className='text-muted-foreground'> {t('you')}</span>
                    )}
                  </p>
                  <p className='text-muted-foreground truncate text-xs'>{m.email}</p>
                </div>
                {editable ? (
                  <>
                    <NativeSelect
                      aria-label={t('role')}
                      className='h-8 text-xs'
                      value={m.role}
                      onChange={(e) =>
                        roleMutation.mutate({ userId: m.userId, role: e.target.value as OrgRole })
                      }
                    >
                      {assignable.map((r) => (
                        <NativeSelectOption key={r} value={r}>
                          {tRole(r)}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <Button
                      size='icon'
                      variant='ghost'
                      aria-label={t('remove')}
                      onClick={() => {
                        if (
                          window.confirm(t('removeConfirm', { name: m.fullName || m.email || '' }))
                        ) {
                          removeMutation.mutate(m.userId);
                        }
                      }}
                    >
                      <Icons.trash className='size-4' />
                    </Button>
                  </>
                ) : (
                  <span className='text-muted-foreground text-sm'>{tRole(m.role)}</span>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {canManage && (
        <Card className='h-fit'>
          <CardHeader>
            <CardTitle>{t('addTitle')}</CardTitle>
            <CardDescription>{t('addDescription')}</CardDescription>
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
                  children={(field) => <field.TextField label={t('email')} type='email' />}
                />
                <form.AppField
                  name='role'
                  children={(field) => (
                    <field.SelectField
                      label={t('role')}
                      options={assignable.map((r) => ({ value: r, label: tRole(r) }))}
                    />
                  )}
                />
              </FieldGroup>
              <form.Subscribe
                selector={(s) => s.isSubmitting}
                children={(submitting) => (
                  <LoadingButton type='submit' loading={submitting} className='w-full'>
                    <Icons.send className='size-4' aria-hidden />
                    {t('add')}
                  </LoadingButton>
                )}
              />
            </form>
          </CardContent>
        </Card>
      )}
      {canManage && (
        <InvitationList
          className='lg:col-span-2'
          invitations={invitations}
          canRevokeOwner={isOwner || isPlatformAdmin}
          busy={resendMutation.isPending || revokeMutation.isPending}
          onResend={(inv) => resendMutation.mutate({ id: inv.id, email: inv.email })}
          onRevoke={(inv) => {
            if (window.confirm(t('revokeConfirm', { email: inv.email })))
              revokeMutation.mutate(inv.id);
          }}
        />
      )}
    </div>
  );
}

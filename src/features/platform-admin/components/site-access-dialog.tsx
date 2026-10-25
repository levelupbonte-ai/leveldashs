'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';
import { Icons } from '@/components/icons';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { FieldGroup } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { useErrorMessage } from '@/hooks/use-error-message';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import { useFields } from '@/lib/validation/use-fields';
import { createActivationCode, revokeActivationCode, setSiteOwnerEmail } from '../api/clients';
import { adminInsightKeys, siteAccessQueryOptions } from '../api/queries';
import type { ActivationCodeStatus, NewActivationCode, OrgRole, SiteAccess } from '../api/types';

const ROLES: OrgRole[] = ['owner', 'admin', 'editor', 'viewer'];
const CODE_VARIANT: Record<
  ActivationCodeStatus,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  active: 'default',
  used: 'secondary',
  expired: 'outline',
  revoked: 'destructive'
};

/** LevelUp staff: owner e-mail and one-time activation codes of one website. */
export function SiteAccessDialog({
  websiteId,
  onOpenChange
}: {
  websiteId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('admin.siteAccess');
  const db = createClient();
  const { data, isPending, isError } = useQuery({
    ...siteAccessQueryOptions(db, websiteId ?? ''),
    enabled: !!websiteId
  });
  return (
    <Dialog open={!!websiteId} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[92vh] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>
            {t('title', { site: data?.website.primary_domain ?? data?.website.name ?? '' })}
          </DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        {isError ? (
          <p className='text-destructive text-sm'>{t('loadFailed')}</p>
        ) : isPending || !data ? (
          <Skeleton className='h-64 w-full' />
        ) : (
          <SiteAccessPanel access={data} />
        )}
      </DialogContent>
    </Dialog>
  );
}

export function SiteAccessPanel({
  access,
  initialCode = null
}: {
  access: SiteAccess;
  /** Screenshot harness only: a code to show as just generated. */
  initialCode?: NewActivationCode | null;
}) {
  const t = useTranslations('admin.siteAccess');
  const tRole = useTranslations('common.roles');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const db = createClient();
  const f = useFields();
  const site = access.website;
  const [fresh, setFresh] = useState<NewActivationCode | null>(initialCode);
  const [copied, setCopied] = useState(false);
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: adminInsightKeys.siteAccess(site.id) });

  const ownerSchema = useMemo(() => z.object({ email: f.email() }), [f]);
  const ownerForm = useAppForm({
    defaultValues: { email: access.owner_claim?.email ?? '' },
    validators: { onSubmit: ownerSchema },
    onSubmit: async ({ value }) => {
      try {
        const { email } = ownerSchema.parse(value);
        await setSiteOwnerEmail(db, site.id, email);
        toast.success(email ? t('ownerEmailSaved', { email }) : t('ownerEmailCleared'));
        await refresh();
      } catch (e) {
        toast.error(errorMessage(e));
      }
    }
  });

  const codeSchema = useMemo(
    () => z.object({ role: f.oneOf(['owner', 'admin', 'editor', 'viewer']), email: f.email() }),
    [f]
  );
  const codeForm = useAppForm({
    defaultValues: { role: (access.owners.length ? 'admin' : 'owner') as OrgRole, email: '' },
    validators: { onSubmit: codeSchema },
    onSubmit: async ({ value, formApi }) => {
      try {
        const clean = codeSchema.parse(value);
        const code = await createActivationCode(db, {
          websiteId: site.id,
          role: clean.role,
          email: clean.email
        });
        setFresh(code);
        setCopied(false);
        formApi.reset();
        await refresh();
      } catch (e) {
        toast.error(errorMessage(e));
      }
    }
  });

  const revoke = useMutation({
    mutationFn: (id: string) => revokeActivationCode(db, id),
    onSuccess: () => {
      toast.success(t('codeRevoked'));
      void refresh();
    },
    onError: (e) => toast.error(errorMessage(e))
  });

  const hasOwner = access.owners.length > 0;

  return (
    <div className='space-y-6 text-sm'>
      <section className='bg-muted/40 grid gap-2 rounded-lg border p-3 sm:grid-cols-2'>
        <div>
          <p className='text-muted-foreground text-xs'>{t('organization')}</p>
          <p className='font-medium'>{site.organization_name}</p>
        </div>
        <div>
          <p className='text-muted-foreground text-xs'>{t('siteId')}</p>
          <p className='font-mono'>{site.id}</p>
        </div>
        <div className='sm:col-span-2'>
          <p className='text-muted-foreground text-xs'>{t('owners')}</p>
          {hasOwner ? (
            <ul>
              {access.owners.map((o) => (
                <li key={o.email} className='break-all'>
                  {o.full_name ? `${o.full_name} · ` : ''}
                  {o.email}
                </li>
              ))}
            </ul>
          ) : (
            <p className='text-amber-700 dark:text-amber-300'>{t('noOwner')}</p>
          )}
        </div>
      </section>

      <section className='space-y-3'>
        <div>
          <h3 className='font-semibold'>{t('ownerEmailTitle')}</h3>
          <p className='text-muted-foreground text-xs'>{t('ownerEmailHint')}</p>
        </div>
        {hasOwner ? (
          <p className='text-muted-foreground rounded-lg border border-dashed p-3'>
            {t('ownerExists')}
          </p>
        ) : (
          <form
            className='flex flex-col gap-3 sm:flex-row sm:items-end'
            onSubmit={(e) => {
              e.preventDefault();
              void ownerForm.handleSubmit();
            }}
          >
            <div className='flex-1'>
              <ownerForm.AppField
                name='email'
                children={(field) => (
                  <field.TextField
                    label={t('ownerEmailLabel')}
                    type='email'
                    placeholder='owner@example.com'
                    description={
                      access.owner_claim
                        ? t('pendingSince', {
                            date: format.dateTime(new Date(access.owner_claim.created_at), {
                              dateStyle: 'medium'
                            })
                          })
                        : undefined
                    }
                  />
                )}
              />
            </div>
            <ownerForm.AppForm>
              <ownerForm.SubmitButton>{t('save')}</ownerForm.SubmitButton>
            </ownerForm.AppForm>
          </form>
        )}
      </section>

      <section className='space-y-3'>
        <div>
          <h3 className='font-semibold'>{t('codesTitle')}</h3>
          <p className='text-muted-foreground text-xs'>{t('codesHint')}</p>
        </div>

        {fresh && (
          <Alert className='border-primary/40 bg-primary/5'>
            <Icons.lock />
            <AlertTitle>{t('codeShownOnce')}</AlertTitle>
            <AlertDescription className='space-y-3'>
              <p className='text-foreground font-mono text-2xl font-semibold tracking-wider select-all'>
                {fresh.code}
              </p>
              <p>
                {t('codeFacts', {
                  role: tRole(fresh.role),
                  date: format.dateTime(new Date(fresh.expires_at), { dateStyle: 'medium' })
                })}
                {fresh.email ? ` ${t('boundTo', { email: fresh.email })}` : ''}
              </p>
              <div className='flex flex-wrap gap-2'>
                <Button
                  type='button'
                  size='sm'
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(fresh.code);
                      setCopied(true);
                    } catch {
                      toast.error(t('copyFailed'));
                    }
                  }}
                >
                  {copied ? <Icons.check className='size-4' /> : <Icons.copy className='size-4' />}
                  {copied ? t('copied') : t('copy')}
                </Button>
                <Button type='button' size='sm' variant='outline' onClick={() => setFresh(null)}>
                  {t('done')}
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        <form
          className='grid gap-3 rounded-lg border p-3 sm:grid-cols-[160px_minmax(0,1fr)_auto] sm:items-end'
          onSubmit={(e) => {
            e.preventDefault();
            void codeForm.handleSubmit();
          }}
        >
          <FieldGroup className='contents'>
            <codeForm.AppField
              name='role'
              children={(field) => (
                <field.SelectField
                  label={t('role')}
                  options={ROLES.map((r) => ({ value: r, label: tRole(r) }))}
                />
              )}
            />
            <codeForm.AppField
              name='email'
              children={(field) => (
                <field.TextField
                  label={t('bindEmail')}
                  type='email'
                  placeholder={t('anyAccount')}
                />
              )}
            />
          </FieldGroup>
          <codeForm.AppForm>
            <codeForm.SubmitButton>
              <Icons.lock className='size-4' aria-hidden />
              {t('generate')}
            </codeForm.SubmitButton>
          </codeForm.AppForm>
        </form>

        {access.codes.length === 0 ? (
          <p className='text-muted-foreground'>{t('noCodes')}</p>
        ) : (
          <ul className='divide-y rounded-lg border'>
            {access.codes.map((c) => (
              <li key={c.id} className='flex flex-col gap-2 p-3 sm:flex-row sm:items-center'>
                <div className='min-w-0 flex-1'>
                  <p className='font-mono'>
                    LVL-…-{c.hint}{' '}
                    <Badge variant={CODE_VARIANT[c.status]} className='ml-1 font-sans'>
                      {t(`codeStatus.${c.status}`)}
                    </Badge>
                  </p>
                  <p className='text-muted-foreground text-xs break-all'>
                    {tRole(c.role)}
                    {c.email ? ` · ${t('boundTo', { email: c.email })}` : ''} ·{' '}
                    {c.status === 'used' && c.used_by_email
                      ? t('usedBy', { email: c.used_by_email })
                      : t('expires', {
                          date: format.dateTime(new Date(c.expires_at), { dateStyle: 'medium' })
                        })}
                  </p>
                </div>
                {c.status === 'active' && (
                  <Button
                    size='sm'
                    variant='ghost'
                    disabled={revoke.isPending}
                    onClick={() => {
                      if (window.confirm(t('revokeConfirm'))) revoke.mutate(c.id);
                    }}
                  >
                    {t('revoke')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

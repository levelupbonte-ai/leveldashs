'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useStore } from '@tanstack/react-form';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';
import { Icons } from '@/components/icons';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useErrorMessage } from '@/hooks/use-error-message';
import {
  nameSimilarity,
  NAME_MATCH_THRESHOLD,
  normalizeHost,
  suggestSites
} from '@/lib/access/host-match';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { PATTERNS } from '@/lib/validation/sanitize';
import { useFields } from '@/lib/validation/use-fields';
import { decideAccessRequest } from '../api/clients';
import { adminInsightKeys, reviewContextQueryOptions } from '../api/queries';
import type { OrgRole, ReviewContext, ReviewDecision, ReviewSite } from '../api/types';

const ROLES: OrgRole[] = ['owner', 'admin', 'editor', 'viewer'];

interface AccessReviewDialogProps {
  userId: string | null;
  /** Approved request attached to an organization without a website. */
  fix?: boolean;
  onOpenChange: (open: boolean) => void;
}

/** LevelUp staff: explicit review of one access request (connect / create / decline). */
export function AccessReviewDialog({ userId, fix = false, onOpenChange }: AccessReviewDialogProps) {
  const t = useTranslations('admin.accessReview');
  const db = createClient();
  const { data, isPending, isError } = useQuery({
    ...reviewContextQueryOptions(db, userId ?? ''),
    enabled: !!userId
  });
  return (
    <Dialog open={!!userId} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[92vh] overflow-y-auto sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>{fix ? t('fixTitle') : t('title')}</DialogTitle>
          <DialogDescription>{fix ? t('fixDescription') : t('description')}</DialogDescription>
        </DialogHeader>
        {isError ? (
          <p className='text-destructive text-sm'>{t('loadFailed')}</p>
        ) : isPending || !data ? (
          <div className='space-y-3'>
            <Skeleton className='h-28 w-full' />
            <Skeleton className='h-40 w-full' />
          </div>
        ) : (
          <ReviewForm context={data} fix={fix} onDone={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Hint({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return (
    <Badge
      variant='outline'
      className={cn(
        'gap-1',
        ok
          ? 'border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
          : 'border-amber-600/30 bg-amber-500/10 text-amber-800 dark:text-amber-200'
      )}
    >
      {ok ? <Icons.check aria-hidden /> : <Icons.warning aria-hidden />}
      {ok ? yes : no}
    </Badge>
  );
}

export function ReviewForm({
  context,
  fix,
  onDone
}: {
  context: ReviewContext;
  fix: boolean;
  onDone: () => void;
}) {
  const t = useTranslations('admin.accessReview');
  const tRole = useTranslations('common.roles');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const f = useFields();
  const req = context.request;
  const [search, setSearch] = useState('');

  const sites = context.websites;
  const suggestions = useMemo(
    () =>
      suggestSites(
        { website: req.website, email: context.email, businessName: req.business_name },
        sites.map((s) => ({
          ...s,
          primaryDomain: s.primary_domain,
          organizationName: s.organization_name
        }))
      ).slice(0, 4),
    [sites, req.website, req.business_name, context.email]
  );
  const similarOrgs = useMemo(
    () =>
      context.organizations
        .map((o) => ({ ...o, score: nameSimilarity(req.business_name, o.name) }))
        .filter(
          (o) =>
            o.score >= NAME_MATCH_THRESHOLD &&
            o.id !== req.organization_id &&
            !suggestions.some((m) => m.site.organization_id === o.id)
        )
        .toSorted((a, b) => b.score - a.score)
        .slice(0, 4),
    [context.organizations, req.business_name, req.organization_id, suggestions]
  );

  const schema = useMemo(
    () =>
      z
        .object({
          mode: z.string(),
          websiteId: z.string(),
          role: z.string(),
          confirmWebsiteId: z.string(),
          organizationName: z.string(),
          createSite: z.boolean(),
          websiteName: z.string(),
          websiteDomain: z.string()
        })
        .superRefine((v, ctx) => {
          if (v.mode !== 'connect' && v.mode !== 'create') {
            ctx.addIssue({ code: 'custom', path: ['mode'], message: t('chooseMode') });
            return;
          }
          if (v.mode === 'connect') {
            const id = v.websiteId.trim().toLowerCase();
            const site = sites.find((s) => s.id === id);
            if (!PATTERNS.websiteId.test(id) || !site) {
              ctx.addIssue({ code: 'custom', path: ['websiteId'], message: t('chooseSite') });
              return;
            }
            if (site.applicant_is_member) {
              ctx.addIssue({
                code: 'custom',
                path: ['websiteId'],
                message: t('applicantIsMember')
              });
            }
            if (!ROLES.includes(v.role as OrgRole)) {
              ctx.addIssue({ code: 'custom', path: ['role'], message: t('chooseRole') });
            }
            if (site.owners > 0 && v.confirmWebsiteId.trim().toLowerCase() !== id) {
              ctx.addIssue({
                code: 'custom',
                path: ['confirmWebsiteId'],
                message: t('confirmMismatch')
              });
            }
          } else {
            const name = f.text(120, { min: 2 }).safeParse(v.organizationName);
            if (!name.success) {
              ctx.addIssue({
                code: 'custom',
                path: ['organizationName'],
                message: t('nameRequired')
              });
            }
            if (v.createSite && v.websiteDomain.trim() && !normalizeHost(v.websiteDomain)) {
              ctx.addIssue({
                code: 'custom',
                path: ['websiteDomain'],
                message: t('domainInvalid')
              });
            }
            if (v.createSite && !f.text(120).safeParse(v.websiteName).success) {
              ctx.addIssue({ code: 'custom', path: ['websiteName'], message: t('nameRequired') });
            }
          }
        }),
    [sites, t, f]
  );

  const finish = (message: string) => {
    toast.success(message);
    void queryClient.invalidateQueries({ queryKey: adminInsightKeys.accessRequests() });
    void queryClient.invalidateQueries({ queryKey: adminInsightKeys.allWebsites() });
    onDone();
  };

  const decide = useMutation({ mutationFn: (input: ReviewDecision) => decideAccessRequest(input) });

  const form = useAppForm({
    defaultValues: {
      mode: '',
      websiteId: '',
      role: '',
      confirmWebsiteId: '',
      organizationName: req.business_name,
      createSite: false,
      websiteName: '',
      websiteDomain: context.requested_host ?? ''
    },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      const input: ReviewDecision =
        value.mode === 'connect'
          ? {
              userId: req.user_id,
              mode: 'connect',
              websiteId: value.websiteId.trim().toLowerCase(),
              role: value.role as OrgRole,
              confirmWebsiteId: value.confirmWebsiteId.trim().toLowerCase() || undefined
            }
          : {
              userId: req.user_id,
              mode: 'create',
              organizationName: f.text(120).parse(value.organizationName),
              websiteName: value.createSite
                ? f.text(120).parse(value.websiteName) || undefined
                : undefined,
              websiteDomain: value.createSite
                ? (normalizeHost(value.websiteDomain) ?? undefined)
                : undefined
            };
      try {
        const out = await decide.mutateAsync(input);
        const site = out.websiteName ?? out.organizationName ?? '';
        if (out.unchanged) finish(t('unchanged'));
        else if (out.archivedOrganizationId) finish(t('fixed', { site }));
        else if (out.emailSent) finish(t('approved', { site, email: context.email ?? '' }));
        else {
          toast.warning(t('approvedNoEmail', { site }));
          finish(t('approvedShort', { site }));
        }
      } catch (e) {
        toast.error(errorMessage(e));
      }
    }
  });

  const values = useStore(form.store, (s) => s.values);
  const selected: ReviewSite | undefined = sites.find(
    (s) => s.id === values.websiteId.trim().toLowerCase()
  );
  const ownerExists = !!selected && selected.owners > 0;

  function pickSite(site: ReviewSite) {
    form.setFieldValue('mode', 'connect');
    form.setFieldValue('websiteId', site.id);
    form.setFieldValue('role', site.owners > 0 ? 'admin' : 'owner');
    form.setFieldValue('confirmWebsiteId', '');
  }

  async function decline() {
    if (!window.confirm(t('declineConfirm', { name: req.business_name }))) return;
    try {
      await decide.mutateAsync({ userId: req.user_id, mode: 'reject' });
      finish(t('declined'));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const requestedHost = context.requested_host;

  return (
    <form
      className='space-y-5'
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      {/* The request */}
      <section className='bg-muted/40 grid gap-3 rounded-lg border p-3 text-sm sm:grid-cols-2'>
        <Detail label={t('account')}>
          <span className='break-all'>{context.email ?? '—'}</span>{' '}
          {context.email_confirmed ? (
            <Hint ok yes={t('emailConfirmed')} no='' />
          ) : (
            <Hint ok={false} yes='' no={t('emailNotConfirmed')} />
          )}
        </Detail>
        <Detail label={t('business')}>{req.business_name}</Detail>
        <Detail label={t('website')}>
          {req.website ? <span className='break-all'>{req.website}</span> : '—'}
          {requestedHost && req.website !== requestedHost && (
            <span className='text-muted-foreground block font-mono text-xs'>{requestedHost}</span>
          )}
        </Detail>
        <Detail label={t('phone')}>{req.phone || '—'}</Detail>
        <Detail label={t('submitted')}>
          {format.dateTime(new Date(req.created_at), { dateStyle: 'medium', timeStyle: 'short' })}
        </Detail>
        {req.full_name && <Detail label={t('name')}>{req.full_name}</Detail>}
        {req.message && (
          <Detail label={t('message')} className='sm:col-span-2'>
            <span className='whitespace-pre-wrap'>{req.message}</span>
          </Detail>
        )}
        {fix && context.current_organization && (
          <Detail label={t('currentOrganization')} className='sm:col-span-2'>
            {context.current_organization.name}{' '}
            <span className='text-muted-foreground'>
              {t('currentOrganizationFacts', {
                websites: context.current_organization.websites,
                members: context.current_organization.members
              })}
            </span>
          </Detail>
        )}
      </section>

      {!context.email_confirmed && (
        <Alert variant='destructive'>
          <Icons.alertCircle />
          <AlertTitle>{t('emailNotConfirmed')}</AlertTitle>
          <AlertDescription>{t('emailNotConfirmedHelp')}</AlertDescription>
        </Alert>
      )}

      {/* Suggested matches */}
      <section className='space-y-2'>
        <h3 className='text-sm font-semibold'>{t('suggestions')}</h3>
        {suggestions.length === 0 && similarOrgs.length === 0 && (
          <p className='text-muted-foreground text-sm'>{t('noSuggestions')}</p>
        )}
        <div className='grid gap-2'>
          {suggestions.map((m) => (
            <div
              key={m.site.id}
              className={cn(
                'flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between',
                selected?.id === m.site.id && 'border-primary ring-primary/20 ring-2'
              )}
            >
              <div className='min-w-0 space-y-1'>
                <p className='font-medium'>
                  {m.site.name}{' '}
                  <span className='text-muted-foreground font-normal'>
                    · {m.site.organizationName}
                  </span>
                </p>
                <p className='text-muted-foreground font-mono text-xs break-all'>
                  {m.site.primaryDomain ?? '—'} · {m.site.id}
                </p>
                <div className='flex flex-wrap gap-1'>
                  <Hint ok={m.hostMatch} yes={t('hintHost')} no={t('hintHostNo')} />
                  <Hint ok={m.emailMatch} yes={t('hintEmail')} no={t('hintEmailNo')} />
                  {m.nameScore >= NAME_MATCH_THRESHOLD && (
                    <Badge variant='secondary'>{t('hintName')}</Badge>
                  )}
                  <Badge variant='outline'>
                    {t('membersOwners', { members: m.site.members, owners: m.site.owners })}
                  </Badge>
                </div>
              </div>
              <Button
                type='button'
                size='sm'
                variant={selected?.id === m.site.id ? 'default' : 'outline'}
                onClick={() => pickSite(m.site)}
              >
                {selected?.id === m.site.id ? t('selected') : t('useSite')}
              </Button>
            </div>
          ))}
          {similarOrgs.map((o) => (
            <div
              key={o.id}
              className='text-muted-foreground rounded-lg border border-dashed p-3 text-sm'
            >
              {t('similarOrganization', { name: o.name, websites: o.websites, owners: o.owners })}
            </div>
          ))}
        </div>
        <p className='text-muted-foreground text-xs'>{t('hintsNote')}</p>
      </section>

      {/* The choice */}
      <form.Field
        name='mode'
        children={(field) => (
          <fieldset className='space-y-2'>
            <legend className='mb-2 text-sm font-semibold'>{t('choice')}</legend>
            <div className='grid gap-2 sm:grid-cols-2'>
              {(fix ? (['connect'] as const) : (['connect', 'create'] as const)).map((mode) => (
                <label
                  key={mode}
                  aria-label={mode === 'connect' ? t('connect') : t('create')}
                  className={cn(
                    'hover:bg-muted/50 flex cursor-pointer gap-3 rounded-lg border p-3',
                    field.state.value === mode && 'border-primary bg-primary/5'
                  )}
                >
                  <input
                    type='radio'
                    name='mode'
                    value={mode}
                    checked={field.state.value === mode}
                    onChange={() => field.handleChange(mode)}
                    className='accent-primary mt-1'
                  />
                  <span>
                    <span className='block font-medium'>
                      {mode === 'connect' ? t('connect') : t('create')}
                    </span>
                    <span className='text-muted-foreground block text-xs'>
                      {mode === 'connect' ? t('connectHint') : t('createHint')}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            {field.state.meta.errors.length > 0 && <FieldError errors={field.state.meta.errors} />}
          </fieldset>
        )}
      />

      {values.mode === 'connect' && (
        <section className='space-y-4'>
          <Command className='rounded-lg! border'>
            <CommandInput placeholder={t('siteSearch')} value={search} onValueChange={setSearch} />
            <CommandList className='max-h-48'>
              <CommandEmpty>{t('noSite')}</CommandEmpty>
              <CommandGroup>
                {sites.map((s) => (
                  <CommandItem
                    key={s.id}
                    value={`${s.name} ${s.primary_domain ?? ''} ${s.id} ${s.organization_name}`}
                    onSelect={() => pickSite(s)}
                  >
                    <div className='min-w-0 flex-1'>
                      <p className='truncate'>
                        {s.name}{' '}
                        <span className='text-muted-foreground'>· {s.organization_name}</span>
                      </p>
                      <p className='text-muted-foreground truncate font-mono text-xs'>
                        {s.primary_domain ?? '—'} · {s.id} ·{' '}
                        {t('membersShort', { count: s.members })}
                      </p>
                    </div>
                    {selected?.id === s.id && <Icons.check className='size-4' />}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>

          <form.Field
            name='websiteId'
            children={(field) => (
              <Field data-invalid={field.state.meta.errors.length > 0}>
                <FieldLabel htmlFor='review-site-id'>{t('siteId')}</FieldLabel>
                <Input
                  id='review-site-id'
                  className='font-mono'
                  placeholder='ws_…'
                  autoComplete='off'
                  maxLength={40}
                  spellCheck={false}
                  value={field.state.value}
                  onChange={(e) => {
                    field.handleChange(e.target.value);
                    const s = sites.find((x) => x.id === e.target.value.trim().toLowerCase());
                    if (s) form.setFieldValue('role', s.owners > 0 ? 'admin' : 'owner');
                  }}
                  aria-invalid={field.state.meta.errors.length > 0}
                />
                <p className='text-muted-foreground text-xs'>{t('siteIdHint')}</p>
                {field.state.meta.errors.length > 0 && (
                  <FieldError errors={field.state.meta.errors} />
                )}
              </Field>
            )}
          />

          {selected && (
            <div className='space-y-3 rounded-lg border p-3'>
              <p className='text-sm font-semibold'>{t('selectedSite')}</p>
              <div className='grid gap-2 text-sm sm:grid-cols-2'>
                <Detail label={t('siteName')}>{selected.name}</Detail>
                <Detail label={t('organization')}>{selected.organization_name}</Detail>
                <Detail label={t('domain')}>{selected.primary_domain ?? '—'}</Detail>
                <Detail label={t('siteId')}>
                  <span className='font-mono'>{selected.id}</span>
                </Detail>
                <Detail label={t('status')}>{selected.status}</Detail>
                <Detail label={t('team')}>
                  {t('membersOwners', { members: selected.members, owners: selected.owners })}
                </Detail>
              </div>
              <div className='flex flex-wrap gap-1'>
                <Hint ok={selected.host_match} yes={t('hintHost')} no={t('hintHostNo')} />
                <Hint ok={selected.email_match} yes={t('hintEmail')} no={t('hintEmailNo')} />
              </div>
              {ownerExists && (
                <Alert>
                  <Icons.warning />
                  <AlertTitle>{t('ownerExists')}</AlertTitle>
                  <AlertDescription>{t('ownerExistsHelp')}</AlertDescription>
                </Alert>
              )}
              <form.AppField
                name='role'
                children={(field) => (
                  <field.SelectField
                    label={t('role')}
                    options={ROLES.map((r) => ({ value: r, label: tRole(r) }))}
                  />
                )}
              />
              {ownerExists && (
                <form.Field
                  name='confirmWebsiteId'
                  children={(field) => (
                    <Field data-invalid={field.state.meta.errors.length > 0}>
                      <FieldLabel htmlFor='review-confirm'>{t('confirmLabel')}</FieldLabel>
                      <Input
                        id='review-confirm'
                        className='font-mono'
                        placeholder={selected.id}
                        autoComplete='off'
                        maxLength={40}
                        spellCheck={false}
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onPaste={(e) => e.preventDefault()}
                        aria-invalid={field.state.meta.errors.length > 0}
                      />
                      {field.state.meta.errors.length > 0 && (
                        <FieldError errors={field.state.meta.errors} />
                      )}
                    </Field>
                  )}
                />
              )}
            </div>
          )}
        </section>
      )}

      {values.mode === 'create' && (
        <section className='space-y-4'>
          {suggestions.some((m) => m.hostMatch) && (
            <Alert>
              <Icons.warning />
              <AlertTitle>{t('createWarning')}</AlertTitle>
              <AlertDescription>{t('createWarningHelp')}</AlertDescription>
            </Alert>
          )}
          <form.AppField
            name='organizationName'
            children={(field) => <field.TextField label={t('organizationName')} maxLength={120} />}
          />
          <form.AppField
            name='createSite'
            children={(field) => <field.CheckboxField label={t('alsoSite')} />}
          />
          {values.createSite && (
            <div className='grid gap-4 sm:grid-cols-2'>
              <form.AppField
                name='websiteName'
                children={(field) => <field.TextField label={t('siteName')} maxLength={120} />}
              />
              <form.AppField
                name='websiteDomain'
                children={(field) => (
                  <field.TextField
                    label={t('domain')}
                    placeholder='example.com'
                    maxLength={253}
                    showCount={false}
                  />
                )}
              />
            </div>
          )}
          <p className='text-muted-foreground text-xs'>{t('createRole')}</p>
        </section>
      )}

      <DialogFooter className='mx-0 mb-0 gap-2 rounded-xl border sm:justify-between'>
        {!fix && req.status === 'pending' ? (
          <Button type='button' variant='ghost' onClick={decline} disabled={decide.isPending}>
            {t('decline')}
          </Button>
        ) : (
          <span />
        )}
        <div className='flex flex-col-reverse gap-2 sm:flex-row'>
          <Button type='button' variant='outline' onClick={onDone}>
            {t('cancel')}
          </Button>
          <form.AppForm>
            <form.SubmitButton disabled={!context.email_confirmed || !values.mode}>
              {values.mode === 'create'
                ? t('approveCreate')
                : selected
                  ? t('approveConnect', { site: selected.primary_domain ?? selected.name })
                  : t('approve')}
            </form.SubmitButton>
          </form.AppForm>
        </div>
      </DialogFooter>
    </form>
  );
}

function Detail({
  label,
  children,
  className
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className='text-muted-foreground text-xs'>{label}</p>
      <div className='mt-0.5'>{children}</div>
    </div>
  );
}

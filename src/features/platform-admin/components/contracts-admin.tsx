'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { parseAsString, useQueryState } from 'nuqs';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';
import { Icons } from '@/components/icons';
import { MfaStepNotice } from '@/components/mfa-step-notice';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingButton } from '@/components/ui/loading-button';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { contractQueryOptions } from '@/features/contracts/api/queries';
import { contractPdfUrl } from '@/features/contracts/api/service';
import {
  ContractDocument,
  OrderFormCard,
  SignatureCertificate
} from '@/features/contracts/components/contract-parts';
import { useErrorMessage } from '@/hooks/use-error-message';
import { useDashboardSession } from '@/lib/auth/session-context';
import type { RequiredTask } from '@/lib/auth/types';
import { AppError } from '@/lib/errors';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import {
  createContract,
  publishTemplate,
  reissueContract,
  sendContract,
  setContractRequired,
  setRequiredTasks,
  updateContract,
  voidContract
} from '../api/contracts';
import {
  adminInsightKeys,
  allWebsitesQueryOptions,
  contractTemplatesQueryOptions,
  orgContractsQueryOptions,
  requiredTasksQueryOptions
} from '../api/queries';
import type { OrderForm } from '@/features/contracts/api/types';
import type { AdminContractInput, AdminContractRow } from '../api/types';

const STATUS_VARIANT: Record<
  AdminContractRow['status'],
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  draft: 'outline',
  sent: 'default',
  signed: 'secondary',
  superseded: 'outline',
  void: 'destructive'
};

function useMfaAwareError() {
  const errorMessage = useErrorMessage();
  const [needsMfa, setNeedsMfa] = useState(false);
  const onError = (error: unknown) => {
    if (error instanceof AppError && error.code === 'mfaRequired') setNeedsMfa(true);
    else toast.error(errorMessage(error));
  };
  return { needsMfa, onError, reset: () => setNeedsMfa(false) };
}

// ---------------------------------------------------------------------------
// Create / edit a draft
// ---------------------------------------------------------------------------

interface ContractFormProps {
  organizationId: string;
  draft: AdminContractRow | null;
  onDone: () => void;
}

/** Loads the draft's order form first, so the form starts with its values. */
function ContractForm(props: ContractFormProps) {
  const db = createClient();
  const { data: existing } = useQuery({
    ...contractQueryOptions(db, props.draft?.id ?? ''),
    enabled: !!props.draft
  });
  if (props.draft && !existing) return <Skeleton className='h-96 w-full' />;
  return <ContractFormFields {...props} initial={existing?.orderForm ?? {}} />;
}

function ContractFormFields({
  organizationId,
  draft,
  onDone,
  initial: form0
}: ContractFormProps & { initial: OrderForm }) {
  const t = useTranslations('admin.contracts.form');
  const db = createClient();
  const queryClient = useQueryClient();
  const { needsMfa, onError, reset } = useMfaAwareError();
  const { data: websites = [] } = useQuery(allWebsitesQueryOptions(db));
  const orgSites = websites.filter((w) => w.organizationId === organizationId);

  const schema = useMemo(
    () =>
      z.object({
        websiteId: z.string(),
        locale: z.enum(['en', 'fr']),
        required: z.boolean(),
        projectName: z.string().max(120),
        packageName: z.string().max(120),
        scope: z.string().max(4000),
        buildPrice: z.string().refine((v) => v === '' || /^\d+(\.\d{1,2})?$/.test(v), t('amount')),
        paymentSchedule: z.string().max(500),
        monthlyPlan: z.string().max(120),
        monthlyPrice: z
          .string()
          .refine((v) => v === '' || /^\d+(\.\d{1,2})?$/.test(v), t('amount')),
        startDate: z.string().refine((v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v), t('date')),
        notes: z.string().max(1000)
      }),
    [t]
  );

  const form = useAppForm({
    defaultValues: {
      websiteId: draft?.websiteId ?? '',
      locale: (draft?.locale ?? 'en') as 'en' | 'fr',
      required: draft?.required ?? true,
      projectName: form0.projectName ?? '',
      packageName: form0.packageName ?? '',
      scope: (form0.scope ?? []).join('\n'),
      buildPrice: form0.buildPrice !== undefined ? String(form0.buildPrice) : '',
      paymentSchedule: form0.paymentSchedule ?? '',
      monthlyPlan: form0.monthlyPlan ?? '',
      monthlyPrice: form0.monthlyPrice !== undefined ? String(form0.monthlyPrice) : '',
      startDate: form0.startDate ?? '',
      notes: form0.notes ?? ''
    },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      reset();
      const input: AdminContractInput = {
        organizationId,
        websiteId: value.websiteId || null,
        locale: value.locale,
        required: value.required,
        orderForm: {
          projectName: value.projectName.trim() || undefined,
          packageName: value.packageName.trim() || undefined,
          scope: value.scope
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean),
          buildPrice: value.buildPrice ? Number(value.buildPrice) : undefined,
          paymentSchedule: value.paymentSchedule.trim() || undefined,
          monthlyPlan: value.monthlyPlan.trim() || undefined,
          monthlyPrice: value.monthlyPrice ? Number(value.monthlyPrice) : undefined,
          startDate: value.startDate || undefined,
          notes: value.notes.trim() || undefined
        }
      };
      try {
        if (draft) await updateContract(db, draft.id, input);
        else await createContract(db, input);
        toast.success(draft ? t('saved') : t('created'));
        await queryClient.invalidateQueries({ queryKey: adminInsightKeys.contracts() });
        if (draft) await queryClient.invalidateQueries({ queryKey: ['contracts'] });
        onDone();
      } catch (error) {
        onError(error);
      }
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{draft ? t('editTitle') : t('createTitle')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          className='space-y-5'
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <FieldGroup className='grid gap-4 md:grid-cols-3'>
            <form.AppField
              name='websiteId'
              children={(field) => (
                <field.SelectField
                  label={t('website')}
                  options={[
                    { value: '', label: t('wholeOrganization') },
                    ...orgSites.map((w) => ({ value: w.id, label: w.name }))
                  ]}
                />
              )}
            />
            <form.AppField
              name='locale'
              children={(field) => (
                <field.SelectField
                  label={t('locale')}
                  description={t('localeHint')}
                  options={[
                    { value: 'en', label: 'English' },
                    { value: 'fr', label: 'Français' }
                  ]}
                />
              )}
            />
            <form.AppField
              name='required'
              children={(field) => (
                <field.SwitchField label={t('required')} description={t('requiredHint')} />
              )}
            />
          </FieldGroup>
          <FieldGroup className='grid gap-4 md:grid-cols-2'>
            <form.AppField
              name='projectName'
              children={(field) => <field.TextField label={t('projectName')} />}
            />
            <form.AppField
              name='packageName'
              children={(field) => <field.TextField label={t('packageName')} />}
            />
            <form.AppField
              name='buildPrice'
              children={(field) => (
                <field.TextField label={t('buildPrice')} inputMode='decimal' placeholder='2400' />
              )}
            />
            <form.AppField
              name='paymentSchedule'
              children={(field) => (
                <field.TextField
                  label={t('paymentSchedule')}
                  placeholder={t('paymentSchedulePlaceholder')}
                />
              )}
            />
            <form.AppField
              name='monthlyPlan'
              children={(field) => <field.TextField label={t('monthlyPlan')} />}
            />
            <form.AppField
              name='monthlyPrice'
              children={(field) => (
                <field.TextField label={t('monthlyPrice')} inputMode='decimal' placeholder='79' />
              )}
            />
            <form.AppField
              name='startDate'
              children={(field) => <field.TextField label={t('startDate')} type='date' />}
            />
          </FieldGroup>
          <form.AppField
            name='scope'
            children={(field) => (
              <field.TextareaField label={t('scope')} description={t('scopeHint')} rows={4} />
            )}
          />
          <form.AppField
            name='notes'
            children={(field) => <field.TextareaField label={t('notes')} rows={2} />}
          />
          {needsMfa && <MfaStepNotice />}
          <div className='flex flex-wrap gap-2'>
            <form.AppForm>
              <form.SubmitButton>{draft ? t('save') : t('create')}</form.SubmitButton>
            </form.AppForm>
            <Button type='button' variant='ghost' onClick={onDone}>
              {t('cancel')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Preview (what the client sees) + certificate
// ---------------------------------------------------------------------------

function PreviewDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const t = useTranslations('admin.contracts');
  const db = createClient();
  const { data: contract } = useQuery({ ...contractQueryOptions(db, id ?? ''), enabled: !!id });
  return (
    <Dialog open={!!id} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-4xl'>
        <DialogHeader>
          <DialogTitle>{t('preview')}</DialogTitle>
          <DialogDescription>{t('previewDescription')}</DialogDescription>
        </DialogHeader>
        {!contract ? (
          <Skeleton className='h-64 w-full' />
        ) : (
          <div className='space-y-4'>
            {contract.signature && (
              <Card className='gap-3'>
                <CardHeader>
                  <CardTitle className='text-base'>{t('certificate')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <SignatureCertificate contractId={contract.id} signature={contract.signature} />
                </CardContent>
              </Card>
            )}
            <OrderFormCard form={contract.orderForm} />
            <ContractDocument contract={contract} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function VoidDialog({ row, onClose }: { row: AdminContractRow | null; onClose: () => void }) {
  const t = useTranslations('admin.contracts');
  const db = createClient();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const { needsMfa, onError, reset } = useMfaAwareError();
  const mutation = useMutation({
    mutationFn: () => voidContract(db, row!.id, reason),
    onMutate: reset,
    onSuccess: async () => {
      toast.success(t('voided'));
      await queryClient.invalidateQueries({ queryKey: adminInsightKeys.contracts() });
      setReason('');
      onClose();
    },
    onError
  });
  return (
    <Dialog open={!!row} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('voidTitle')}</DialogTitle>
          <DialogDescription>{t('voidDescription')}</DialogDescription>
        </DialogHeader>
        <div className='space-y-2'>
          <Label htmlFor='void-reason'>{t('voidReason')}</Label>
          <Input
            id='void-reason'
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        {needsMfa && <MfaStepNotice />}
        <DialogFooter>
          <Button variant='ghost' onClick={onClose}>
            {t('form.cancel')}
          </Button>
          <LoadingButton
            variant='destructive'
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {t('void')}
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Contracts of one organization
// ---------------------------------------------------------------------------

function OrgContracts({ organizationId }: { organizationId: string }) {
  const t = useTranslations('admin.contracts');
  const ts = useTranslations('contract.status');
  const format = useFormatter();
  const db = createClient();
  const queryClient = useQueryClient();
  const { data: contracts, isLoading } = useQuery(orgContractsQueryOptions(db, organizationId));
  const { data: templates = [] } = useQuery(contractTemplatesQueryOptions(db));
  const [editing, setEditing] = useState<AdminContractRow | 'new' | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<AdminContractRow | null>(null);
  const { needsMfa, onError, reset } = useMfaAwareError();
  const latest = Math.max(
    0,
    ...templates.filter((x) => x.key === 'msa' && x.locale === 'en').map((x) => x.version)
  );

  const refresh = () => queryClient.invalidateQueries({ queryKey: adminInsightKeys.contracts() });
  const send = useMutation({
    mutationFn: (id: string) => sendContract(id),
    onMutate: reset,
    onSuccess: async (r) => {
      toast.success(t('sent', { notified: r.notified, recipients: r.recipients }));
      await refresh();
    },
    onError
  });
  const reissue = useMutation({
    mutationFn: (id: string) => reissueContract(db, id),
    onMutate: reset,
    onSuccess: async () => {
      toast.success(t('reissued'));
      await refresh();
    },
    onError
  });
  const required = useMutation({
    mutationFn: ({ id, value }: { id: string; value: boolean }) =>
      setContractRequired(db, id, value),
    onMutate: reset,
    onSuccess: refresh,
    onError
  });

  if (editing) {
    return (
      <ContractForm
        organizationId={organizationId}
        draft={editing === 'new' ? null : editing}
        onDone={() => setEditing(null)}
      />
    );
  }

  return (
    <Card>
      <CardHeader className='flex flex-row items-start justify-between gap-4'>
        <div className='space-y-1.5'>
          <CardTitle>{t('listTitle')}</CardTitle>
          <CardDescription>{t('listDescription')}</CardDescription>
        </div>
        <Button size='sm' onClick={() => setEditing('new')}>
          <Icons.add className='size-4' aria-hidden />
          {t('new')}
        </Button>
      </CardHeader>
      <CardContent className='space-y-3'>
        {needsMfa && <MfaStepNotice />}
        {isLoading ? (
          <Skeleton className='h-24 w-full' />
        ) : !contracts?.length ? (
          <p className='text-muted-foreground text-sm'>{t('none')}</p>
        ) : (
          <ul className='divide-y rounded-lg border'>
            {contracts.map((c) => (
              <li key={c.id} className='flex flex-col gap-3 p-3 lg:flex-row lg:items-center'>
                <div className='min-w-0 flex-1 space-y-1'>
                  <p className='flex flex-wrap items-center gap-2 text-sm font-medium'>
                    {c.title}
                    <Badge variant={STATUS_VARIANT[c.status]}>{ts(c.status)}</Badge>
                    {c.required && ['draft', 'sent'].includes(c.status) && (
                      <Badge variant='outline'>{t('requiredBadge')}</Badge>
                    )}
                    {c.status !== 'void' && c.templateVersion < latest && (
                      <Badge variant='outline'>{t('newerVersion', { version: latest })}</Badge>
                    )}
                  </p>
                  <p className='text-muted-foreground text-xs'>
                    {t('meta', {
                      version: c.templateVersion,
                      locale: c.locale.toUpperCase(),
                      date: format.dateTime(new Date(c.createdAt), { dateStyle: 'medium' })
                    })}
                    {c.signerName && ` · ${t('signedBy', { name: c.signerName })}`}
                    {c.voidReason && ` · ${c.voidReason}`}
                  </p>
                </div>
                <div className='flex flex-wrap gap-1.5'>
                  <Button size='sm' variant='outline' onClick={() => setPreview(c.id)}>
                    {c.status === 'signed' || c.status === 'superseded'
                      ? t('certificate')
                      : t('preview')}
                  </Button>
                  {c.status === 'draft' && (
                    <>
                      <Button size='sm' variant='outline' onClick={() => setEditing(c)}>
                        {t('edit')}
                      </Button>
                      <LoadingButton
                        size='sm'
                        loading={send.isPending && send.variables === c.id}
                        onClick={() => send.mutate(c.id)}
                      >
                        <Icons.send className='size-4' aria-hidden />
                        {t('send')}
                      </LoadingButton>
                    </>
                  )}
                  {c.status === 'sent' && (
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={() => required.mutate({ id: c.id, value: !c.required })}
                    >
                      {c.required ? t('makeOptional') : t('makeRequired')}
                    </Button>
                  )}
                  {(c.status === 'signed' || c.status === 'superseded') && (
                    <a
                      href={contractPdfUrl(c.id)}
                      download
                      className={buttonVariants({ size: 'sm', variant: 'outline' })}
                    >
                      <Icons.download className='size-4' aria-hidden />
                      PDF
                    </a>
                  )}
                  {c.status !== 'draft' && c.status !== 'void' && (
                    <LoadingButton
                      size='sm'
                      variant='outline'
                      loading={reissue.isPending && reissue.variables === c.id}
                      onClick={() => reissue.mutate(c.id)}
                    >
                      {t('reissue')}
                    </LoadingButton>
                  )}
                  {['draft', 'sent', 'signed'].includes(c.status) && (
                    <Button size='sm' variant='ghost' onClick={() => setVoiding(c)}>
                      {t('void')}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <PreviewDialog id={preview} onClose={() => setPreview(null)} />
      <VoidDialog row={voiding} onClose={() => setVoiding(null)} />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Blocking setup tasks
// ---------------------------------------------------------------------------

const TASKS: RequiredTask[] = ['profile', 'logo', 'mfa'];

function RequiredTasksEditor({ organizationId }: { organizationId: string }) {
  const t = useTranslations('admin.contracts.tasks');
  const ts = useTranslations('setup.tasks');
  const db = createClient();
  const queryClient = useQueryClient();
  const { data: saved } = useQuery(requiredTasksQueryOptions(db, organizationId));
  const [draft, setDraft] = useState<RequiredTask[] | null>(null);
  const selected = draft ?? saved ?? [];
  const { needsMfa, onError, reset } = useMfaAwareError();
  const save = useMutation({
    mutationFn: () => setRequiredTasks(db, organizationId, selected),
    onMutate: reset,
    onSuccess: async () => {
      toast.success(t('saved'));
      setDraft(null);
      await queryClient.invalidateQueries({
        queryKey: adminInsightKeys.requiredTasks(organizationId)
      });
    },
    onError
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        <div className='space-y-3'>
          {TASKS.map((task) => (
            <div key={task} className='flex items-center gap-3'>
              <Checkbox
                id={`task-${task}`}
                checked={selected.includes(task)}
                onCheckedChange={(checked) =>
                  setDraft(
                    checked ? [...new Set([...selected, task])] : selected.filter((x) => x !== task)
                  )
                }
              />
              <Label htmlFor={`task-${task}`} className='font-normal'>
                {ts(`${task}.title`)}
              </Label>
            </div>
          ))}
        </div>
        {needsMfa && <MfaStepNotice />}
        <LoadingButton
          size='sm'
          loading={save.isPending}
          disabled={!draft}
          onClick={() => save.mutate()}
        >
          {t('save')}
        </LoadingButton>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function TemplatesCard() {
  const t = useTranslations('admin.contracts.templates');
  const format = useFormatter();
  const db = createClient();
  const queryClient = useQueryClient();
  const { data: templates = [] } = useQuery(contractTemplatesQueryOptions(db));
  const [open, setOpen] = useState(false);
  const { needsMfa, onError, reset } = useMfaAwareError();
  const schema = useMemo(
    () =>
      z.object({
        locale: z.enum(['en', 'fr']),
        version: z.string().refine((v) => v === '' || /^\d{1,4}$/.test(v), t('versionHint')),
        title: z.string().trim().min(1, t('titleRequired')).max(200),
        body: z.string().trim().min(20, t('bodyRequired')).max(200000)
      }),
    [t]
  );
  const form = useAppForm({
    defaultValues: { locale: 'en' as 'en' | 'fr', version: '', title: '', body: '' },
    validators: { onSubmit: schema },
    onSubmit: async ({ value, formApi }) => {
      reset();
      try {
        const version = await publishTemplate(db, {
          key: 'msa',
          locale: value.locale,
          version: value.version ? Number(value.version) : null,
          title: value.title,
          body: value.body
        });
        toast.success(t('published', { version }));
        formApi.reset();
        setOpen(false);
        await queryClient.invalidateQueries({ queryKey: adminInsightKeys.templates() });
      } catch (error) {
        onError(error);
      }
    }
  });
  return (
    <Card>
      <CardHeader className='flex flex-row items-start justify-between gap-4'>
        <div className='space-y-1.5'>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </div>
        <Button size='sm' variant='outline' onClick={() => setOpen((v) => !v)}>
          {t('publish')}
        </Button>
      </CardHeader>
      <CardContent className='space-y-4'>
        <ul className='divide-y rounded-lg border text-sm'>
          {templates.map((tpl) => (
            <li key={tpl.id} className='flex flex-wrap items-center justify-between gap-2 p-3'>
              <span className='font-medium'>
                {tpl.title}{' '}
                <span className='text-muted-foreground font-normal'>
                  · v{tpl.version} · {tpl.locale.toUpperCase()}
                </span>
              </span>
              <span className='text-muted-foreground text-xs'>
                {tpl.publishedAt
                  ? format.dateTime(new Date(tpl.publishedAt), { dateStyle: 'medium' })
                  : t('unpublished')}
              </span>
            </li>
          ))}
        </ul>
        {open && (
          <form
            noValidate
            className='space-y-4'
            onSubmit={(e) => {
              e.preventDefault();
              void form.handleSubmit();
            }}
          >
            <FieldGroup className='grid gap-4 md:grid-cols-3'>
              <form.AppField
                name='locale'
                children={(field) => (
                  <field.SelectField
                    label={t('locale')}
                    options={[
                      { value: 'en', label: t('english') },
                      { value: 'fr', label: t('french') }
                    ]}
                  />
                )}
              />
              <form.AppField
                name='version'
                children={(field) => (
                  <field.TextField
                    label={t('version')}
                    description={t('versionHint')}
                    inputMode='numeric'
                  />
                )}
              />
              <form.AppField
                name='title'
                children={(field) => <field.TextField label={t('templateTitle')} />}
              />
            </FieldGroup>
            <form.AppField
              name='body'
              children={(field) => (
                <field.TextareaField label={t('body')} description={t('bodyHint')} rows={10} />
              )}
            />
            {needsMfa && <MfaStepNotice />}
            <form.AppForm>
              <form.SubmitButton>{t('publishSubmit')}</form.SubmitButton>
            </form.AppForm>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page body
// ---------------------------------------------------------------------------

/** /dashboard/exclusive/contracts — LevelUp staff only. */
export function ContractsAdmin() {
  const t = useTranslations('admin.contracts');
  const { organizations } = useDashboardSession();
  const [orgId, setOrgId] = useQueryState('org', parseAsString.withDefault(''));
  const org = organizations.find((o) => o.id === orgId) ?? null;

  return (
    <div className='space-y-6'>
      <Card>
        <CardHeader>
          <CardTitle>{t('clientTitle')}</CardTitle>
          <CardDescription>{t('clientDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Label htmlFor='contract-org' className='sr-only'>
            {t('client')}
          </Label>
          <NativeSelect
            id='contract-org'
            value={orgId}
            onChange={(e) => void setOrgId(e.target.value || null)}
            className='w-full sm:w-96'
          >
            <NativeSelectOption value=''>{t('chooseClient')}</NativeSelectOption>
            {organizations.map((o) => (
              <NativeSelectOption key={o.id} value={o.id}>
                {o.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </CardContent>
      </Card>
      {org && (
        <>
          <OrgContracts key={org.id} organizationId={org.id} />
          <RequiredTasksEditor key={`tasks-${org.id}`} organizationId={org.id} />
        </>
      )}
      <TemplatesCard />
    </div>
  );
}

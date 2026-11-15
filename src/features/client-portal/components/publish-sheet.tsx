'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet';
import { useErrorMessage } from '@/hooks/use-error-message';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import { useFields } from '@/lib/validation/use-fields';
import { useSiteScope } from '@/features/site/components/use-site-scope';
import { portalKeys, portalSettingsQueryOptions } from '../api/queries';
import { publishPortalItem, uploadPortalDocument } from '../api/service';
import {
  PORTAL_DOCUMENT_TYPES,
  type PortalAudience,
  type PortalItemInput,
  type PortalItemKind,
  type PortalOverview
} from '../api/types';
import { parseChecklist, parseSteps } from '../lib/parse';
import { MemberPicker } from './member-picker';
import { useNudgeEmails } from './use-nudge-emails';

/**
 * Compose and publish an update, trip details, a document or a checklist to
 * one customer, an offer group or every customer. The database validates the
 * item again and queues the "new update" e-mails.
 */
export function PublishSheet({
  open,
  onOpenChange,
  initialCustomerId,
  initialCustomerIds,
  data
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialCustomerId?: string;
  /** Members chosen in the inbox: publish to exactly them. */
  initialCustomerIds?: string[];
  data: PortalOverview;
}) {
  const t = useTranslations('clientPortal.publish');
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className='w-full overflow-y-auto sm:max-w-xl'>
        <SheetHeader>
          <SheetTitle>{t('title')}</SheetTitle>
          <SheetDescription>{t('description')}</SheetDescription>
        </SheetHeader>
        {open && (
          <PublishForm
            data={data}
            initialCustomerId={initialCustomerId}
            initialCustomerIds={initialCustomerIds}
            onDone={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function PublishForm({
  data,
  initialCustomerId,
  initialCustomerIds,
  onDone
}: {
  data: PortalOverview;
  initialCustomerId?: string;
  /** Members chosen in the inbox: publish to exactly them. */
  initialCustomerIds?: string[];
  onDone: () => void;
}) {
  const scope = useSiteScope();
  const t = useTranslations('clientPortal.publish');
  const tk = useTranslations('clientPortal');
  const tv = useTranslations('validation');
  const f = useFields();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const nudge = useNudgeEmails();
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const customers = data.customers.filter((c) => c.status === 'active');
  const { data: settings } = useQuery(portalSettingsQueryOptions(createClient(), scope.websiteId));
  const planName = (level: number) =>
    settings?.plans.find((p) => p.level === level)?.name ?? tk('settings.levelN', { level });

  const schema = useMemo(
    () =>
      z
        .object({
          kind: z.enum(['update', 'trip', 'document', 'checklist']),
          audience: z.enum(['all', 'offer', 'customer', 'customers']),
          customerId: z.string(),
          customerIds: z.array(z.string()).max(200),
          offerId: z.string(),
          title: f.text(160, { min: 1 }),
          body: f.text(8000, { multiline: true }),
          startDate: f.date(),
          endDate: f.date(),
          meetingPoint: f.text(300),
          meetingTime: f.text(40),
          steps: f.text(6000, { multiline: true }),
          checklist: f.text(6000, { multiline: true }),
          minLevel: f.oneOf(['0', '1', '2', '3']),
          notify: z.boolean()
        })
        .superRefine((v, ctx) => {
          if (v.audience === 'customer' && !v.customerId) {
            ctx.addIssue({ code: 'custom', path: ['customerId'], message: tv('required') });
          }
          if (v.audience === 'customers' && v.customerIds.length === 0) {
            ctx.addIssue({ code: 'custom', path: ['customerIds'], message: tv('required') });
          }
          if (v.audience === 'offer' && !v.offerId) {
            ctx.addIssue({ code: 'custom', path: ['offerId'], message: tv('required') });
          }
          if (v.kind === 'checklist' && parseChecklist(v.checklist).length === 0) {
            ctx.addIssue({ code: 'custom', path: ['checklist'], message: tv('required') });
          }
        }),
    [f, tv]
  );

  const form = useAppForm({
    defaultValues: {
      kind: 'update' as PortalItemKind,
      audience: (initialCustomerIds?.length
        ? 'customers'
        : initialCustomerId
          ? 'customer'
          : 'all') as PortalAudience,
      customerId: initialCustomerId ?? '',
      customerIds: initialCustomerIds ?? ([] as string[]),
      offerId: '',
      title: '',
      body: '',
      startDate: '',
      endDate: '',
      meetingPoint: '',
      meetingTime: '',
      steps: '',
      checklist: '',
      minLevel: '0',
      notify: true
    },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      const v = schema.parse(value);
      if (v.kind === 'document' && !file) {
        setFileError(tv('required'));
        return;
      }
      try {
        const item: PortalItemInput = {
          kind: v.kind,
          audience: v.audience,
          title: v.title,
          body: v.body || undefined,
          min_level: Number(v.minLevel)
        };
        if (v.audience === 'customer') item.customer_id = v.customerId;
        if (v.audience === 'offer') item.offer_id = v.offerId;
        if (v.audience === 'customers') item.customer_ids = v.customerIds;
        if (v.kind === 'trip') {
          item.trip = {
            start_date: v.startDate || null,
            end_date: v.endDate || null,
            meeting_point: v.meetingPoint || null,
            meeting_time: v.meetingTime || null,
            steps: parseSteps(v.steps)
          };
        }
        if (v.kind === 'checklist') item.checklist = parseChecklist(v.checklist);
        if (v.kind === 'document' && file) {
          item.document_path = await uploadPortalDocument(createClient(), scope, file);
          item.document_name = file.name.slice(0, 160);
        }
        const res = await publishPortalItem(createClient(), scope.websiteId, item, v.notify);
        toast.success(t('published', { count: res.notified }));
        if (res.notified > 0) nudge();
        void queryClient.invalidateQueries({ queryKey: portalKeys.all(scope.websiteId) });
        onDone();
      } catch (error) {
        toast.error(errorMessage(error));
      }
    }
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
      className='flex flex-col gap-4 px-4 pb-4'
    >
      <div className='bg-muted/40 flex flex-wrap items-center gap-3 rounded-lg border p-3'>
        <div className='min-w-0 flex-1'>
          <p className='text-sm font-medium'>{t('template.title')}</p>
          <p className='text-muted-foreground text-xs'>{t('template.hint')}</p>
        </div>
        <Button
          type='button'
          size='sm'
          variant='outline'
          onClick={() => {
            form.setFieldValue('kind', 'update');
            form.setFieldValue('audience', 'all');
            form.setFieldValue('minLevel', '0');
            form.setFieldValue('notify', true);
            form.setFieldValue('title', t('template.itemTitle'));
            form.setFieldValue('body', t('template.itemBody'));
          }}
        >
          {t('template.use')}
        </Button>
      </div>
      <FieldGroup>
        <form.AppField
          name='kind'
          children={(field) => (
            <field.SelectField
              label={t('kind')}
              options={(['update', 'trip', 'document', 'checklist'] as const).map((k) => ({
                value: k,
                label: tk(`kinds.${k}`)
              }))}
            />
          )}
        />
        <form.AppField
          name='audience'
          children={(field) => (
            <field.RadioGroupField
              label={t('audience')}
              options={[
                { value: 'all', label: tk('audience.all') },
                ...(data.offers.length > 0
                  ? [{ value: 'offer', label: tk('audience.offer') }]
                  : []),
                ...(customers.length > 0
                  ? [
                      { value: 'customers', label: tk('audience.customers') },
                      { value: 'customer', label: tk('audience.customer') }
                    ]
                  : [])
              ]}
            />
          )}
        />
        <form.Subscribe selector={(s) => [s.values.audience, s.values.kind] as const}>
          {([audience, kind]) => (
            <>
              {audience === 'customer' && (
                <form.AppField
                  name='customerId'
                  children={(field) => (
                    <field.SelectField
                      label={t('customer')}
                      options={customers.map((c) => ({
                        value: c.id,
                        label: c.name ? `${c.name} · ${c.email}` : c.email
                      }))}
                    />
                  )}
                />
              )}
              {audience === 'customers' && (
                <form.Field
                  name='customerIds'
                  children={(field) => (
                    <div className='space-y-1'>
                      <MemberPicker
                        value={field.state.value}
                        onChange={(ids) => field.handleChange(ids)}
                        invalid={field.state.meta.errors.length > 0}
                      />
                      {field.state.meta.errors.length > 0 && (
                        <p className='text-destructive text-xs'>{tv('required')}</p>
                      )}
                    </div>
                  )}
                />
              )}
              {audience === 'offer' && (
                <form.AppField
                  name='offerId'
                  children={(field) => (
                    <field.SelectField
                      label={t('offer')}
                      options={data.offers.map((o) => ({ value: o.id, label: o.name ?? o.id }))}
                    />
                  )}
                />
              )}
              <form.AppField
                name='title'
                children={(field) => (
                  <field.TextField label={t('titleLabel')} maxLength={160} required />
                )}
              />
              <form.AppField
                name='body'
                children={(field) => (
                  <field.TextareaField
                    label={kind === 'update' ? t('message') : t('notes')}
                    rows={5}
                    maxLength={8000}
                  />
                )}
              />
              {kind === 'trip' && (
                <>
                  <div className='grid gap-4 sm:grid-cols-2'>
                    <form.AppField
                      name='startDate'
                      children={(field) => <field.TextField label={t('startDate')} type='date' />}
                    />
                    <form.AppField
                      name='endDate'
                      children={(field) => <field.TextField label={t('endDate')} type='date' />}
                    />
                  </div>
                  <form.AppField
                    name='meetingPoint'
                    children={(field) => (
                      <field.TextField label={t('meetingPoint')} maxLength={300} />
                    )}
                  />
                  <form.AppField
                    name='meetingTime'
                    children={(field) => (
                      <field.TextField
                        label={t('meetingTime')}
                        placeholder={t('meetingTimePlaceholder')}
                        maxLength={40}
                      />
                    )}
                  />
                  <form.AppField
                    name='steps'
                    children={(field) => (
                      <field.TextareaField
                        label={t('steps')}
                        description={t('stepsHint')}
                        rows={5}
                      />
                    )}
                  />
                </>
              )}
              {kind === 'checklist' && (
                <form.AppField
                  name='checklist'
                  children={(field) => (
                    <field.TextareaField
                      label={t('checklist')}
                      description={t('checklistHint')}
                      rows={6}
                    />
                  )}
                />
              )}
              {kind === 'document' && (
                <Field data-invalid={!!fileError}>
                  <FieldLabel htmlFor='portal-document'>{t('document')}</FieldLabel>
                  <Input
                    id='portal-document'
                    type='file'
                    accept={PORTAL_DOCUMENT_TYPES.join(',')}
                    aria-invalid={!!fileError}
                    onChange={(e) => {
                      setFile(e.target.files?.[0] ?? null);
                      setFileError(null);
                    }}
                  />
                  <FieldDescription>{t('documentHint')}</FieldDescription>
                  {fileError && <FieldError>{fileError}</FieldError>}
                </Field>
              )}
            </>
          )}
        </form.Subscribe>
        <form.AppField
          name='minLevel'
          children={(field) => (
            <field.SelectField
              label={t('level')}
              description={t('levelHint')}
              options={[
                { value: '0', label: t('levelFree') },
                ...([1, 2, 3] as const).map((l) => ({
                  value: String(l),
                  label: t('levelPlan', { plan: planName(l) })
                }))
              ]}
            />
          )}
        />
        <form.AppField
          name='notify'
          children={(field) => (
            <field.SwitchField label={t('notify')} description={t('notifyHint')} />
          )}
        />
      </FieldGroup>
      <SheetFooter className='flex-row justify-end gap-2 px-0'>
        <Button type='button' variant='outline' onClick={onDone}>
          {t('cancel')}
        </Button>
        <form.AppForm>
          <form.SubmitButton>{t('submit')}</form.SubmitButton>
        </form.AppForm>
      </SheetFooter>
    </form>
  );
}

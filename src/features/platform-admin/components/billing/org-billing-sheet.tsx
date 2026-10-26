'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import type { BillingStatus, ChargeRow } from '@/features/billing/api/types';
import { CHARGE_VARIANT, ChargeActions, dayDate } from '@/features/billing/components/charges-card';
import { useDiscountText } from '@/features/billing/components/discount-badge';
import { LimitMeters } from '@/features/billing/components/usage-cards';
import {
  CURRENCY_RE,
  formatMoney,
  majorToMinor,
  minorToField
} from '@/features/billing/lib/format';
import { useErrorMessage } from '@/hooks/use-error-message';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { setDiscountActive, setOrgBilling, voidCharge } from '../../api/billing';
import { orgBillingQueryOptions } from '../../api/queries';
import type { OrgBillingDetail, OrgDiscountRow } from '../../api/types';
import { ChargeDialog, MarkPaidDialog, useRefreshBilling } from './charge-dialogs';
import { ConfirmDialog } from './confirm-dialog';
import { DiscountDialog, emptyDiscount, type DiscountDraft } from './discount-dialog';
import { IssuerWarning } from './issuer-card';

const STATUSES: BillingStatus[] = ['active', 'trial', 'past_due', 'suspended'];

/** LevelUp staff: billing of one organization (plan, price, charges, discounts). */
export function OrgBillingSheet({
  organizationId,
  onOpenChange
}: {
  organizationId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('admin.billing.sheet');
  const { data, isPending, isError } = useQuery({
    ...orgBillingQueryOptions(createClient(), organizationId ?? ''),
    enabled: !!organizationId
  });
  return (
    <Sheet open={!!organizationId} onOpenChange={onOpenChange}>
      <SheetContent className='w-full overflow-y-auto data-[side=right]:sm:max-w-2xl'>
        <SheetHeader>
          <SheetTitle>{t('title', { name: data?.organization.name ?? '' })}</SheetTitle>
          <SheetDescription>{t('description')}</SheetDescription>
        </SheetHeader>
        <div className='px-4 pb-6'>
          {isError ? (
            <p className='text-destructive text-sm'>{t('loadFailed')}</p>
          ) : isPending || !data ? (
            <Skeleton className='h-96 w-full' />
          ) : (
            <OrgBillingPanel detail={data} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function OrgBillingPanel({ detail }: { detail: OrgBillingDetail }) {
  const t = useTranslations('admin.billing.sheet');
  return (
    <div className='space-y-8 text-sm'>
      <BillingSettingsForm key={detail.billing.updated_at ?? 'new'} detail={detail} />
      <section className='space-y-3'>
        <h3 className='font-semibold'>{t('usage')}</h3>
        <LimitMeters usage={detail.usage} />
      </section>
      <ChargesSection detail={detail} />
      <DiscountsSection detail={detail} />
    </div>
  );
}

function BillingSettingsForm({ detail }: { detail: OrgBillingDetail }) {
  const t = useTranslations('admin.billing.sheet');
  const tStatus = useTranslations('billing.status');
  const tv = useTranslations('validation');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const refresh = useRefreshBilling();
  const b = detail.billing;
  const money = detail.money;
  const schema = useMemo(
    () =>
      z.object({
        planKey: z.string().min(1, { message: tv('choice') }),
        status: z.enum(['active', 'trial', 'past_due', 'suspended']),
        customPrice: z
          .number({ error: tv('invalid') })
          .min(0, { message: tv('invalid') })
          .max(1000000, { message: tv('invalid') })
          .optional(),
        currency: z
          .string()
          .trim()
          .regex(CURRENCY_RE, { message: tv('invalid') }),
        note: z
          .string()
          .trim()
          .max(1000, { message: tv('maxLength', { max: 1000 }) }),
        nextDueDate: z.string()
      }),
    [tv]
  );
  const defaults: {
    planKey: string;
    status: BillingStatus;
    customPrice?: number;
    currency: string;
    note: string;
    nextDueDate: string;
  } = {
    planKey: b.plan_key,
    status: b.status,
    customPrice: minorToField(b.custom_price, b.currency),
    currency: b.currency.toUpperCase(),
    note: b.billing_note ?? '',
    nextDueDate: b.next_due_date ?? ''
  };
  const form = useAppForm({
    defaultValues: defaults,
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      const currency = value.currency.trim().toLowerCase();
      try {
        await setOrgBilling(createClient(), {
          organizationId: detail.organization.id,
          planKey: value.planKey,
          status: value.status,
          customPrice: majorToMinor(value.customPrice, currency),
          currency,
          note: value.note,
          nextDueDate: value.nextDueDate || null
        });
        toast.success(t('saved'));
        await refresh();
      } catch (e) {
        toast.error(errorMessage(e, 'saveFailed'));
      }
    }
  });

  return (
    <section className='space-y-3'>
      <div className='flex flex-wrap items-baseline justify-between gap-2'>
        <h3 className='font-semibold'>{t('settings')}</h3>
        {money && (
          <p className='text-muted-foreground text-xs'>
            {money.price === null
              ? t('effectiveUnset')
              : t('effective', {
                  price: formatMoney(
                    format.number,
                    money.price_after_discount ?? money.price,
                    money.currency
                  )
                })}
          </p>
        )}
      </div>
      <form
        className='space-y-4 rounded-lg border p-4'
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <FieldGroup>
          <div className='grid gap-4 sm:grid-cols-2'>
            <form.AppField
              name='planKey'
              children={(field) => (
                <field.SelectField
                  label={t('plan')}
                  options={detail.plans.map((p) => ({
                    value: p.key,
                    label: p.name
                  }))}
                />
              )}
            />
            <form.AppField
              name='status'
              children={(field) => (
                <field.SelectField
                  label={t('status')}
                  options={STATUSES.map((s) => ({
                    value: s,
                    label: tStatus(s)
                  }))}
                />
              )}
            />
          </div>
          <div className='grid gap-4 sm:grid-cols-[minmax(0,1fr)_120px]'>
            <form.Subscribe
              selector={(s) => s.values.currency}
              children={(cur) => (
                <form.AppField
                  name='customPrice'
                  children={(field) => (
                    <field.TextField
                      label={t('customPrice')}
                      type='number'
                      inputMode='decimal'
                      step='0.01'
                      min='0'
                      description={t('customPriceHint', {
                        currency: cur.toUpperCase()
                      })}
                    />
                  )}
                />
              )}
            />
            <form.AppField
              name='currency'
              children={(field) => (
                <field.TextField label={t('currency')} maxLength={3} className='uppercase' />
              )}
            />
          </div>
          <form.AppField
            name='nextDueDate'
            children={(field) => <field.TextField label={t('nextDue')} type='date' />}
          />
          <form.AppField
            name='note'
            children={(field) => (
              <field.TextareaField
                label={t('note')}
                description={t('noteHint')}
                rows={2}
                maxLength={1000}
              />
            )}
          />
        </FieldGroup>
        <div className='flex justify-end'>
          <form.AppForm>
            <form.SubmitButton>{t('save')}</form.SubmitButton>
          </form.AppForm>
        </div>
      </form>
    </section>
  );
}

function ChargesSection({ detail }: { detail: OrgBillingDetail }) {
  const t = useTranslations('admin.billing.sheet');
  const tc = useTranslations('admin.billing.charge');
  const tOwe = useTranslations('billing.owe');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const refresh = useRefreshBilling();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ChargeRow | null>(null);
  const [paying, setPaying] = useState<ChargeRow | null>(null);
  const [voiding, setVoiding] = useState<ChargeRow | null>(null);
  const charges = detail.money?.charges ?? [];
  const currency = detail.money?.currency ?? detail.billing.currency;
  const fmt = (c: ChargeRow) => formatMoney(format.number, c.amount, c.currency);
  const voidMutation = useMutation({
    mutationFn: (id: string) => voidCharge(createClient(), id),
    onSuccess: async () => {
      toast.success(tc('voided'));
      await refresh();
    },
    onError: (e) => toast.error(errorMessage(e, 'saveFailed'))
  });

  return (
    <section className='space-y-3'>
      <div className='flex items-center justify-between gap-2'>
        <h3 className='font-semibold'>{t('charges')}</h3>
        <Button size='sm' onClick={() => setCreating(true)}>
          <Icons.add className='size-4' aria-hidden />
          {t('addCharge')}
        </Button>
      </div>
      {detail.money && !detail.money.documents_ready && <IssuerWarning />}
      {charges.length === 0 ? (
        <p className='text-muted-foreground rounded-lg border border-dashed p-4'>
          {t('noCharges')}
        </p>
      ) : (
        <ul className='divide-y rounded-lg border'>
          {charges.map((c) => {
            const open = c.status === 'due' || c.status === 'overdue';
            return (
              <li
                key={c.id}
                className={cn(
                  'flex flex-col gap-2 p-3 sm:flex-row sm:items-center',
                  c.status === 'void' && 'opacity-60'
                )}
              >
                <div className='min-w-0 flex-1'>
                  <p className='font-medium break-words'>
                    {c.label}{' '}
                    <Badge variant={CHARGE_VARIANT[c.status]} className='ml-1'>
                      {tOwe(`chargeStatus.${c.status}`)}
                    </Badge>
                  </p>
                  <p className='text-muted-foreground text-xs'>
                    <span className='tabular-nums'>{c.invoice_number}</span>
                    {' · '}
                    {tOwe(`kind.${c.kind}`)}
                    {c.due_date
                      ? ` · ${tOwe('dueDate')} ${format.dateTime(dayDate(c.due_date), { dateStyle: 'medium' })}`
                      : ''}
                    {c.discount_amount > 0
                      ? ` · ${c.discount_label} −${formatMoney(format.number, c.discount_amount, c.currency)}`
                      : ''}
                    {c.status === 'paid' && c.payment_method && c.paid_at
                      ? ` · ${tc('paidWith', {
                          method: tc(`methods.${c.payment_method}`),
                          date: format.dateTime(new Date(c.paid_at), { dateStyle: 'medium' })
                        })}`
                      : ''}
                    {c.payment_reference ? ` · ${c.payment_reference}` : ''}
                  </p>
                  {/* Staff can preview documents before the business details are complete (marked draft). */}
                  <ChargeActions charge={c} documents className='pt-2' />
                </div>
                <div className='flex items-center gap-1'>
                  <span className='mr-2 font-semibold tabular-nums'>{fmt(c)}</span>
                  {open && (
                    <>
                      <Button size='sm' variant='ghost' onClick={() => setEditing(c)}>
                        {tc('edit')}
                      </Button>
                      <Button size='sm' variant='outline' onClick={() => setPaying(c)}>
                        {tc('markPaid')}
                      </Button>
                      <Button
                        size='icon'
                        variant='ghost'
                        aria-label={tc('void')}
                        disabled={voidMutation.isPending}
                        onClick={() => setVoiding(c)}
                      >
                        <Icons.ban className='size-4' />
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <ChargeDialog
        open={creating || !!editing}
        organizationId={detail.organization.id}
        currency={currency}
        charge={editing}
        onOpenChange={(v) => {
          if (!v) {
            setCreating(false);
            setEditing(null);
          }
        }}
      />
      <MarkPaidDialog charge={paying} onOpenChange={(v) => !v && setPaying(null)} />
      <ConfirmDialog
        open={!!voiding}
        destructive
        title={tc('void')}
        description={voiding ? tc('voidConfirm', { amount: fmt(voiding) }) : ''}
        confirmLabel={tc('void')}
        onConfirm={() => voiding && voidMutation.mutate(voiding.id)}
        onOpenChange={(v) => !v && setVoiding(null)}
      />
    </section>
  );
}

function DiscountsSection({ detail }: { detail: OrgBillingDetail }) {
  const t = useTranslations('admin.billing.sheet');
  const discountText = useDiscountText();
  const errorMessage = useErrorMessage();
  const refresh = useRefreshBilling();
  const [draft, setDraft] = useState<DiscountDraft | null>(null);
  const [ending, setEnding] = useState<OrgDiscountRow | null>(null);
  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      setDiscountActive(createClient(), id, active),
    onSuccess: () => refresh(),
    onError: (e) => toast.error(errorMessage(e, 'saveFailed'))
  });
  const orgId = detail.organization.id;

  return (
    <section className='space-y-3'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h3 className='font-semibold'>{t('discounts')}</h3>
        <div className='flex gap-2'>
          <Button
            size='sm'
            variant='outline'
            onClick={() => setDraft(emptyDiscount(orgId, t('partnerLabel')))}
          >
            <Icons.discount className='size-4' aria-hidden />
            {t('addPartner')}
          </Button>
          <Button size='sm' variant='ghost' onClick={() => setDraft(emptyDiscount(orgId))}>
            <Icons.add className='size-4' aria-hidden />
            {t('addDiscount')}
          </Button>
        </div>
      </div>
      {detail.org_discounts.length === 0 ? (
        <p className='text-muted-foreground rounded-lg border border-dashed p-4'>
          {t('noDiscounts')}
        </p>
      ) : (
        <ul className='divide-y rounded-lg border'>
          {detail.org_discounts.map((d) => (
            <li key={d.id} className='flex flex-col gap-2 p-3 sm:flex-row sm:items-center'>
              <div className='min-w-0 flex-1'>
                <p className='font-medium'>
                  {discountText(d)}{' '}
                  <Badge variant={d.in_effect ? 'default' : 'outline'} className='ml-1'>
                    {d.in_effect ? t('inEffect') : t('notInEffect')}
                  </Badge>
                </p>
                {d.code && (
                  <p className='text-muted-foreground font-mono text-xs'>
                    {t('redeemedCode', { code: d.code })}
                  </p>
                )}
              </div>
              {!d.redeemed && (
                <div className='flex gap-1'>
                  <Button
                    size='sm'
                    variant='ghost'
                    onClick={() => setDraft({ ...d, organizationId: orgId, value: d.value })}
                  >
                    <Icons.edit className='size-4' aria-hidden />
                  </Button>
                  {d.active ? (
                    <Button size='sm' variant='ghost' onClick={() => setEnding(d)}>
                      {t('deactivate')}
                    </Button>
                  ) : (
                    <Button
                      size='sm'
                      variant='ghost'
                      onClick={() => toggle.mutate({ id: d.id, active: true })}
                    >
                      {t('activate')}
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <DiscountDialog draft={draft} onOpenChange={(v) => !v && setDraft(null)} />
      <ConfirmDialog
        open={!!ending}
        destructive
        title={t('deactivate')}
        description={t('deactivateConfirm')}
        confirmLabel={t('deactivate')}
        onConfirm={() => ending && toggle.mutate({ id: ending.id, active: false })}
        onOpenChange={(v) => !v && setEnding(null)}
      />
    </section>
  );
}

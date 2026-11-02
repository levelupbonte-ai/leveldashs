'use client';
import { useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { FieldGroup } from '@/components/ui/field';
import { billingKeys } from '@/features/billing/api/queries';
import {
  PAYMENT_METHODS,
  type ChargeKind,
  type ChargeRow,
  type PaymentMethod
} from '@/features/billing/api/types';
import {
  CURRENCY_RE,
  formatMoney,
  majorToMinor,
  minorToField
} from '@/features/billing/lib/format';
import { useErrorMessage } from '@/hooks/use-error-message';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import { createCharge, recordChargePayment, updateCharge } from '../../api/billing';
import { adminInsightKeys } from '../../api/queries';

const KINDS: ChargeKind[] = ['subscription', 'setup', 'one_off'];

/** Refresh every staff billing list and the client view of the organization. */
export function useRefreshBilling() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: adminInsightKeys.billing() }),
      queryClient.invalidateQueries({ queryKey: billingKeys.all })
    ]);
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Create a charge, or edit one still due. The database computes the discount and the total. */
export function ChargeDialog({
  open,
  organizationId,
  currency,
  charge,
  onOpenChange
}: {
  open: boolean;
  organizationId: string;
  /** The organization's billing currency (default for a new charge). */
  currency: string;
  charge?: ChargeRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[92vh] overflow-y-auto sm:max-w-lg'>
        {open && (
          <ChargeForm
            organizationId={organizationId}
            currency={currency}
            charge={charge ?? null}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ChargeForm({
  organizationId,
  currency,
  charge,
  onDone
}: {
  organizationId: string;
  currency: string;
  charge: ChargeRow | null;
  onDone: () => void;
}) {
  const t = useTranslations('admin.billing.charge');
  const tKind = useTranslations('billing.owe.kind');
  const tv = useTranslations('validation');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const refresh = useRefreshBilling();
  const schema = useMemo(
    () =>
      z
        .object({
          kind: z.enum(['subscription', 'setup', 'one_off']),
          label: z
            .string()
            .trim()
            .min(1, { message: tv('required') })
            .max(120, { message: tv('maxLength', { max: 120 }) }),
          description: z
            .string()
            .trim()
            .max(1000, { message: tv('maxLength', { max: 1000 }) }),
          amount: z
            .number({ error: tv('invalid') })
            .positive({ message: tv('invalid') })
            .max(1000000, { message: tv('invalid') })
            .optional(),
          currency: z
            .string()
            .trim()
            .regex(CURRENCY_RE, { message: tv('invalid') }),
          dueDate: z.string(),
          applyDiscount: z.boolean()
        })
        .refine((v) => v.kind === 'subscription' || v.amount !== undefined, {
          path: ['amount'],
          message: tv('required')
        }),
    [tv]
  );
  const defaults: {
    kind: ChargeKind;
    label: string;
    description: string;
    amount?: number;
    currency: string;
    dueDate: string;
    applyDiscount: boolean;
  } = {
    kind: charge?.kind ?? 'subscription',
    label: charge?.label ?? '',
    description: charge?.description ?? '',
    amount: minorToField(charge?.base_amount, charge?.currency ?? currency),
    currency: (charge?.currency ?? currency).toUpperCase(),
    dueDate: charge?.due_date ?? '',
    applyDiscount: charge ? charge.discount_amount > 0 : true
  };
  const form = useAppForm({
    defaultValues: defaults,
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      const db = createClient();
      const cur = value.currency.trim().toLowerCase();
      try {
        const amount = majorToMinor(value.amount, cur);
        if (charge) {
          await updateCharge(db, charge.id, {
            label: value.label.trim(),
            description: value.description,
            amount,
            dueDate: value.dueDate || null,
            applyDiscount: value.applyDiscount
          });
          toast.success(t('updated'));
        } else {
          const row = await createCharge(db, {
            organizationId,
            kind: value.kind,
            label: value.label.trim(),
            description: value.description,
            amount,
            currency: cur,
            dueDate: value.dueDate || null,
            applyDiscount: value.applyDiscount
          });
          toast.success(
            t('created', {
              amount: formatMoney(format.number, row.amount, row.currency)
            })
          );
        }
        await refresh();
        onDone();
      } catch (e) {
        toast.error(errorMessage(e, 'saveFailed'));
      }
    }
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>{charge ? t('editTitle') : t('title')}</DialogTitle>
      </DialogHeader>
      <form
        id='charge-form'
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <FieldGroup>
          {!charge && (
            <form.AppField
              name='kind'
              children={(field) => (
                <field.SelectField
                  label={t('kind')}
                  options={KINDS.map((k) => ({ value: k, label: tKind(k) }))}
                />
              )}
            />
          )}
          <form.AppField
            name='label'
            children={(field) => (
              <field.TextField
                label={t('label')}
                required
                placeholder={t('labelPlaceholder')}
                maxLength={120}
              />
            )}
          />
          <form.AppField
            name='description'
            children={(field) => (
              <field.TextareaField label={t('description')} rows={2} maxLength={1000} />
            )}
          />
          <div className='grid gap-4 sm:grid-cols-[minmax(0,1fr)_120px]'>
            <form.Subscribe
              selector={(s) => s.values.currency}
              children={(cur) => (
                <form.AppField
                  name='amount'
                  children={(field) => (
                    <field.TextField
                      label={t('amount')}
                      type='number'
                      inputMode='decimal'
                      step='0.01'
                      min='0'
                      description={t('amountHint', {
                        currency: cur.toUpperCase()
                      })}
                    />
                  )}
                />
              )}
            />
            {!charge && (
              <form.AppField
                name='currency'
                children={(field) => (
                  <field.TextField
                    label={t('currency')}
                    maxLength={3}
                    showCount={false}
                    className='uppercase'
                  />
                )}
              />
            )}
          </div>
          <form.AppField
            name='dueDate'
            children={(field) => <field.TextField label={t('dueDate')} type='date' />}
          />
          <form.AppField
            name='applyDiscount'
            children={(field) => <field.SwitchField label={t('applyDiscount')} />}
          />
        </FieldGroup>
      </form>
      <DialogFooter>
        <Button variant='outline' onClick={onDone}>
          {t('cancel')}
        </Button>
        <form.AppForm>
          <form.SubmitButton form='charge-form'>
            {charge ? t('update') : t('create')}
          </form.SubmitButton>
        </form.AppForm>
      </DialogFooter>
    </>
  );
}

/** Record a payment received outside the app. */
export function MarkPaidDialog({
  charge,
  onOpenChange
}: {
  charge: ChargeRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={!!charge} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        {charge && <MarkPaidForm charge={charge} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function MarkPaidForm({ charge, onDone }: { charge: ChargeRow; onDone: () => void }) {
  const t = useTranslations('admin.billing.charge');
  const tv = useTranslations('validation');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const refresh = useRefreshBilling();
  const schema = useMemo(
    () =>
      z.object({
        method: z.enum(PAYMENT_METHODS, { error: tv('choice') }),
        paidOn: z.string().min(1, { message: tv('date') }),
        reference: z
          .string()
          .trim()
          .max(120, { message: tv('maxLength', { max: 120 }) })
      }),
    [tv]
  );
  const defaults: { method: PaymentMethod; paidOn: string; reference: string } = {
    method: 'bank_transfer',
    paidOn: today(),
    reference: ''
  };
  const form = useAppForm({
    defaultValues: defaults,
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      try {
        await recordChargePayment(createClient(), charge.id, value);
        toast.success(t('paid'));
        await refresh();
        onDone();
      } catch (e) {
        toast.error(errorMessage(e, 'saveFailed'));
      }
    }
  });
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('paidTitle')}</DialogTitle>
        <DialogDescription>
          {charge.label} · {formatMoney(format.number, charge.amount, charge.currency)}
        </DialogDescription>
      </DialogHeader>
      <p className='text-muted-foreground text-sm'>{t('paidDescription')}</p>
      <form
        id='mark-paid-form'
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <FieldGroup>
          <form.AppField
            name='method'
            children={(field) => (
              <field.SelectField
                label={t('paymentMethod')}
                options={PAYMENT_METHODS.map((m) => ({ value: m, label: t(`methods.${m}`) }))}
              />
            )}
          />
          <form.AppField
            name='paidOn'
            children={(field) => <field.TextField label={t('paidOn')} type='date' max={today()} />}
          />
          <form.AppField
            name='reference'
            children={(field) => (
              <field.TextField
                label={t('paymentNote')}
                placeholder={t('paymentNotePlaceholder')}
                maxLength={120}
              />
            )}
          />
        </FieldGroup>
      </form>
      <DialogFooter>
        <Button variant='outline' onClick={onDone}>
          {t('cancel')}
        </Button>
        <form.AppForm>
          <form.SubmitButton form='mark-paid-form'>{t('confirmPaid')}</form.SubmitButton>
        </form.AppForm>
      </DialogFooter>
    </>
  );
}

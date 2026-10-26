'use client';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { FieldGroup } from '@/components/ui/field';
import type { DiscountKind, DiscountScope } from '@/features/billing/api/types';
import {
  CURRENCY_RE,
  PROMO_CODE_RE,
  majorToMinor,
  minorToField
} from '@/features/billing/lib/format';
import { useErrorMessage } from '@/hooks/use-error-message';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import { saveDiscount } from '../../api/billing';
import { useRefreshBilling } from './charge-dialogs';

const SCOPES: DiscountScope[] = ['all', 'subscription', 'setup'];
const NO_ORG = '__none__';

/** What the dialog edits; `id` null creates. */
export interface DiscountDraft {
  id: string | null;
  organizationId: string | null;
  code: string | null;
  label: string;
  kind: DiscountKind;
  /** Percent, or minor units for a fixed amount; null = empty field. */
  value: number | null;
  currency: string | null;
  applies_to: DiscountScope;
  starts_at: string | null;
  ends_at: string | null;
  max_uses: number | null;
  active: boolean;
}

export const emptyDiscount = (organizationId: string | null, label = ''): DiscountDraft => ({
  id: null,
  organizationId,
  code: null,
  label,
  kind: 'percent',
  value: null,
  currency: null,
  applies_to: 'all',
  starts_at: null,
  ends_at: null,
  max_uses: null,
  active: true
});

const dayOf = (iso: string | null) => (iso ? iso.slice(0, 10) : '');

/**
 * Create or edit a discount. An organization discount (no code) applies at
 * once ("Partner"); a promo code applies once redeemed from Billing.
 */
export function DiscountDialog({
  draft,
  organizations,
  onOpenChange
}: {
  draft: DiscountDraft | null;
  /** Organizations to choose from; omitted when the organization is fixed. */
  organizations?: { id: string; name: string }[];
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={!!draft} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[92vh] overflow-y-auto sm:max-w-lg'>
        {draft && (
          <DiscountForm
            draft={draft}
            organizations={organizations}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DiscountForm({
  draft,
  organizations,
  onDone
}: {
  draft: DiscountDraft;
  organizations?: { id: string; name: string }[];
  onDone: () => void;
}) {
  const t = useTranslations('admin.billing.discount');
  const tv = useTranslations('validation');
  const errorMessage = useErrorMessage();
  const refresh = useRefreshBilling();
  const editing = draft.id !== null;
  const schema = useMemo(
    () =>
      z
        .object({
          organizationId: z.string(),
          code: z
            .string()
            .trim()
            .refine((v) => v === '' || PROMO_CODE_RE.test(v), {
              message: tv('invalid')
            }),
          label: z
            .string()
            .trim()
            .min(1, { message: tv('required') })
            .max(60),
          kind: z.enum(['percent', 'fixed']),
          value: z.number({ error: tv('required') }).positive({ message: tv('invalid') }),
          currency: z.string().trim(),
          appliesTo: z.enum(['all', 'subscription', 'setup']),
          startsAt: z.string(),
          endsAt: z.string(),
          maxUses: z
            .number()
            .int({ message: tv('invalid') })
            .positive({ message: tv('invalid') })
            .optional(),
          active: z.boolean()
        })
        .refine((v) => v.kind !== 'percent' || (Number.isInteger(v.value) && v.value <= 100), {
          path: ['value'],
          message: tv('invalid')
        })
        .refine((v) => v.kind !== 'fixed' || CURRENCY_RE.test(v.currency), {
          path: ['currency'],
          message: tv('invalid')
        })
        .refine((v) => !v.startsAt || !v.endsAt || v.endsAt >= v.startsAt, {
          path: ['endsAt'],
          message: tv('date')
        })
        .refine((v) => v.organizationId !== NO_ORG || v.code !== '', {
          path: ['code'],
          message: t('codeRequired')
        }),
    [t, tv]
  );
  const currency = draft.currency ?? 'usd';
  const defaults: {
    organizationId: string;
    code: string;
    label: string;
    kind: DiscountKind;
    value?: number;
    currency: string;
    appliesTo: DiscountScope;
    startsAt: string;
    endsAt: string;
    maxUses?: number;
    active: boolean;
  } = {
    organizationId: draft.organizationId ?? NO_ORG,
    code: draft.code ?? '',
    label: draft.label,
    kind: draft.kind,
    value:
      draft.value === null
        ? undefined
        : draft.kind === 'fixed'
          ? minorToField(draft.value, currency)
          : draft.value,
    currency: currency.toUpperCase(),
    appliesTo: draft.applies_to,
    startsAt: dayOf(draft.starts_at),
    endsAt: dayOf(draft.ends_at),
    maxUses: draft.max_uses ?? undefined,
    active: draft.active
  };
  const form = useAppForm({
    defaultValues: defaults,
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      if (value.value === undefined) return;
      const cur = value.currency.trim().toLowerCase();
      try {
        await saveDiscount(createClient(), {
          id: draft.id,
          organizationId: value.organizationId === NO_ORG ? null : value.organizationId,
          code: value.code,
          label: value.label.trim(),
          kind: value.kind,
          value: value.kind === 'fixed' ? (majorToMinor(value.value, cur) ?? 0) : value.value,
          currency: value.kind === 'fixed' ? cur : null,
          appliesTo: value.appliesTo,
          startsAt: value.startsAt || null,
          endsAt: value.endsAt || null,
          maxUses: value.maxUses ?? null,
          active: value.active
        });
        toast.success(t('saved'));
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
        <DialogTitle>{editing ? t('editTitle') : t('title')}</DialogTitle>
      </DialogHeader>
      <form
        id='discount-form'
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <FieldGroup>
          {organizations && !editing && (
            <form.AppField
              name='organizationId'
              children={(field) => (
                <field.SelectField
                  label={t('organization')}
                  options={[
                    { value: NO_ORG, label: t('anyOrganization') },
                    ...organizations.map((o) => ({
                      value: o.id,
                      label: o.name
                    }))
                  ]}
                />
              )}
            />
          )}
          {!editing && (
            <form.AppField
              name='code'
              children={(field) => (
                <field.TextField
                  label={t('code')}
                  description={t('codeHint')}
                  maxLength={32}
                  autoComplete='off'
                  className='font-mono uppercase placeholder:normal-case'
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
                maxLength={60}
              />
            )}
          />
          <div className='grid gap-4 sm:grid-cols-2'>
            <form.AppField
              name='kind'
              children={(field) => (
                <field.SelectField
                  label={t('kind')}
                  options={[
                    { value: 'percent', label: t('percent') },
                    { value: 'fixed', label: t('fixed') }
                  ]}
                />
              )}
            />
            <form.Subscribe
              selector={(s) => s.values.kind}
              children={(kind) => (
                <form.AppField
                  name='value'
                  children={(field) => (
                    <field.TextField
                      label={t('value')}
                      required
                      type='number'
                      inputMode='decimal'
                      step={kind === 'percent' ? '1' : '0.01'}
                      min='0'
                      description={kind === 'percent' ? t('valueHintPercent') : t('valueHintFixed')}
                    />
                  )}
                />
              )}
            />
          </div>
          <form.Subscribe
            selector={(s) => s.values.kind}
            children={(kind) =>
              kind === 'fixed' ? (
                <form.AppField
                  name='currency'
                  children={(field) => (
                    <field.TextField label={t('currency')} maxLength={3} className='uppercase' />
                  )}
                />
              ) : null
            }
          />
          <form.AppField
            name='appliesTo'
            children={(field) => (
              <field.SelectField
                label={t('appliesTo')}
                options={SCOPES.map((s) => ({
                  value: s,
                  label: t(`scope.${s}`)
                }))}
              />
            )}
          />
          <div className='grid gap-4 sm:grid-cols-2'>
            <form.AppField
              name='startsAt'
              children={(field) => <field.TextField label={t('startsAt')} type='date' />}
            />
            <form.AppField
              name='endsAt'
              children={(field) => <field.TextField label={t('endsAt')} type='date' />}
            />
          </div>
          <form.AppField
            name='maxUses'
            children={(field) => (
              <field.TextField
                label={t('maxUses')}
                type='number'
                inputMode='numeric'
                min='1'
                step='1'
                description={t('maxUsesHint')}
              />
            )}
          />
          <form.AppField
            name='active'
            children={(field) => <field.SwitchField label={t('active')} />}
          />
        </FieldGroup>
      </form>
      <DialogFooter>
        <Button variant='outline' onClick={onDone}>
          {t('cancel')}
        </Button>
        <form.AppForm>
          <form.SubmitButton form='discount-form'>{t('save')}</form.SubmitButton>
        </form.AppForm>
      </DialogFooter>
    </>
  );
}

'use client';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { FieldGroup, FieldLegend, FieldSet } from '@/components/ui/field';
import { LIMIT_KEYS, PLAN_FEATURES, type LimitKey } from '@/features/billing/api/types';
import { taglineFor } from '@/features/billing/components/plan-card';
import {
  CURRENCY_RE,
  formatMoney,
  majorToMinor,
  minorToField,
  storageParts
} from '@/features/billing/lib/format';
import { useErrorMessage } from '@/hooks/use-error-message';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import { savePlan } from '../../api/billing';
import { plansQueryOptions } from '../../api/queries';
import type { PlanRow } from '../../api/types';
import { useRefreshBilling } from './charge-dialogs';

/** Staff: price, currency, limits and features of every plan. */
export function PlansAdmin() {
  const { data } = useSuspenseQuery(plansQueryOptions(createClient()));
  const t = useTranslations('admin.billing.plan');
  const tb = useTranslations('billing');
  const format = useFormatter();
  const [editing, setEditing] = useState<PlanRow | null>(null);

  const limitValue = (key: LimitKey, v: number | null | undefined) => {
    if (v === null || v === undefined) return t('unlimited');
    if (key === 'media_mb') {
      const s = storageParts(v * 1048576);
      return `${format.number(s.value)} ${s.unit}`;
    }
    return format.number(v);
  };

  return (
    <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
      {data.map((p) => (
        <Card key={p.key} className='flex flex-col'>
          <CardHeader>
            <CardTitle className='flex flex-wrap items-center gap-2'>
              {p.name}
              {p.is_default && <Badge>{t('default')}</Badge>}
              {!p.active && <Badge variant='outline'>{t('inactive')}</Badge>}
            </CardTitle>
            <p className='text-muted-foreground text-sm'>
              {p.description || taglineFor(tb, p.key)}
            </p>
            <p className='pt-2 text-xl font-semibold tabular-nums'>
              {p.price_monthly === null
                ? tb('plan.priceUnset')
                : p.price_monthly === 0
                  ? tb('plan.free')
                  : tb('plan.perMonth', {
                      price: formatMoney(format.number, p.price_monthly, p.currency)
                    })}
            </p>
          </CardHeader>
          <CardContent className='flex-1 space-y-3 text-sm'>
            <ul className='space-y-1'>
              {LIMIT_KEYS.map((k) => (
                <li key={k} className='flex justify-between gap-2'>
                  <span className='text-muted-foreground'>{tb(`limits.${k}`)}</span>
                  <span className='font-medium tabular-nums'>{limitValue(k, p.limits[k])}</span>
                </li>
              ))}
            </ul>
            <ul className='space-y-0.5'>
              {p.features.map((f) => (
                <li key={f} className='flex gap-2'>
                  <Icons.check className='text-primary mt-0.5 size-4 shrink-0' aria-hidden />
                  {tb.has(`features.${f}` as never) ? tb(`features.${f}` as never) : f}
                </li>
              ))}
            </ul>
          </CardContent>
          <CardFooter>
            <Button variant='outline' className='w-full' onClick={() => setEditing(p)}>
              <Icons.edit className='size-4' aria-hidden />
              {t('edit')}
            </Button>
          </CardFooter>
        </Card>
      ))}
      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className='max-h-[92vh] overflow-y-auto sm:max-w-xl'>
          {editing && <PlanForm plan={editing} onDone={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PlanForm({ plan, onDone }: { plan: PlanRow; onDone: () => void }) {
  const t = useTranslations('admin.billing.plan');
  const tb = useTranslations('billing');
  const tv = useTranslations('validation');
  const errorMessage = useErrorMessage();
  const refresh = useRefreshBilling();
  const optionalCount = useMemo(
    () =>
      z
        .number({ error: tv('invalid') })
        .int({ message: tv('invalid') })
        .min(0, { message: tv('invalid') })
        .max(10000000, { message: tv('invalid') })
        .optional(),
    [tv]
  );
  const schema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .trim()
          .min(1, { message: tv('required') })
          .max(60),
        description: z.string().trim().max(500),
        price: z
          .number({ error: tv('invalid') })
          .min(0, { message: tv('invalid') })
          .max(1000000, { message: tv('invalid') })
          .optional(),
        currency: z
          .string()
          .trim()
          .regex(CURRENCY_RE, { message: tv('invalid') }),
        team_members: optionalCount,
        assistant_requests_month: optionalCount,
        media_mb: optionalCount,
        websites: optionalCount,
        features: z.array(z.string()),
        sortOrder: z.number({ error: tv('invalid') }).int({ message: tv('invalid') }),
        active: z.boolean(),
        isDefault: z.boolean()
      }),
    [tv, optionalCount]
  );
  const limit = (k: LimitKey) => plan.limits[k] ?? undefined;
  const defaults: {
    name: string;
    description: string;
    price?: number;
    currency: string;
    team_members?: number;
    assistant_requests_month?: number;
    media_mb?: number;
    websites?: number;
    features: string[];
    sortOrder: number;
    active: boolean;
    isDefault: boolean;
  } = {
    name: plan.name,
    description: plan.description ?? '',
    price: minorToField(plan.price_monthly, plan.currency),
    currency: plan.currency.toUpperCase(),
    team_members: limit('team_members'),
    assistant_requests_month: limit('assistant_requests_month'),
    media_mb: limit('media_mb'),
    websites: limit('websites'),
    features: plan.features,
    sortOrder: plan.sort_order,
    active: plan.active,
    isDefault: plan.is_default
  };
  const form = useAppForm({
    defaultValues: defaults,
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      const currency = value.currency.trim().toLowerCase();
      try {
        await savePlan(createClient(), {
          key: plan.key,
          name: value.name.trim(),
          description: value.description,
          price_monthly: majorToMinor(value.price, currency),
          currency,
          // Every limit key is sent: an empty field means unlimited (null).
          limits: Object.fromEntries(LIMIT_KEYS.map((k) => [k, value[k] ?? null])),
          features: value.features,
          sort_order: value.sortOrder,
          active: value.active,
          is_default: value.isDefault
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
        <DialogTitle>{t('title', { name: plan.name })}</DialogTitle>
      </DialogHeader>
      <form
        id='plan-form'
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <FieldGroup>
          <form.AppField
            name='name'
            children={(field) => <field.TextField label={t('name')} required maxLength={60} />}
          />
          <form.AppField
            name='description'
            children={(field) => (
              <field.TextareaField
                label={t('description')}
                description={t('descriptionHint')}
                rows={2}
                maxLength={500}
              />
            )}
          />
          <div className='grid gap-4 sm:grid-cols-[minmax(0,1fr)_120px]'>
            <form.AppField
              name='price'
              children={(field) => (
                <field.TextField
                  label={t('price')}
                  type='number'
                  inputMode='decimal'
                  step='0.01'
                  min='0'
                  description={t('priceHint')}
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
          <FieldSet>
            <FieldLegend variant='label'>{t('limits')}</FieldLegend>
            <p className='text-muted-foreground -mt-2 text-xs'>{t('limitsHint')}</p>
            <div className='grid gap-4 sm:grid-cols-2'>
              {LIMIT_KEYS.map((k) => (
                <form.AppField
                  key={k}
                  name={k}
                  children={(field) => (
                    <field.TextField
                      label={k === 'media_mb' ? `${tb(`limits.${k}`)} (MB)` : tb(`limits.${k}`)}
                      type='number'
                      inputMode='numeric'
                      min='0'
                      step='1'
                      placeholder={t('unlimited')}
                    />
                  )}
                />
              ))}
            </div>
          </FieldSet>
          <form.AppField
            name='features'
            mode='array'
            children={(field) => (
              <field.CheckboxGroupField
                label={t('features')}
                options={PLAN_FEATURES.map((f) => ({
                  value: f,
                  label: tb(`features.${f}`)
                }))}
              />
            )}
          />
          <form.AppField
            name='sortOrder'
            children={(field) => (
              <field.TextField label={t('sortOrder')} type='number' step='1' inputMode='numeric' />
            )}
          />
          <form.AppField
            name='active'
            children={(field) => <field.SwitchField label={t('active')} />}
          />
          <form.AppField
            name='isDefault'
            children={(field) => <field.SwitchField label={t('isDefault')} />}
          />
        </FieldGroup>
      </form>
      <DialogFooter>
        <Button variant='outline' onClick={onDone}>
          {t('cancel')}
        </Button>
        <form.AppForm>
          <form.SubmitButton form='plan-form'>{t('save')}</form.SubmitButton>
        </form.AppForm>
      </DialogFooter>
    </>
  );
}

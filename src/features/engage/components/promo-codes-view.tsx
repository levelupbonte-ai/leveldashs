'use client';

import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';
import { FieldGroup } from '@/components/ui/field';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet';
import { useErrorMessage } from '@/hooks/use-error-message';
import { AppError } from '@/lib/errors';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import { useFields } from '@/lib/validation/use-fields';
import { formatMoney, majorToMinor, minorToMajor } from '@/features/payments/lib/money';
import { useSiteScope } from '@/features/site/components/use-site-scope';
import { engageKeys, promoCodesQueryOptions } from '../api/queries';
import { savePromoCode } from '../api/service';
import type { PromoCode } from '../api/types';
import { fromLocalInput, toLocalInput } from './dates';

/**
 * Promo codes the website's server checks before opening the payment page.
 * A code is counted only when the payment goes through.
 */
export function PromoCodesView() {
  const scope = useSiteScope();
  const t = useTranslations('engage.promos');
  const format = useFormatter();
  const { data } = useSuspenseQuery(promoCodesQueryOptions(createClient(), scope.websiteId));
  const [editing, setEditing] = useState<PromoCode | null | undefined>(undefined);
  const [now] = useState(() => Date.now());

  const state = (p: PromoCode) => {
    if (!p.active) return 'off';
    if (p.ends_at && new Date(p.ends_at).getTime() <= now) return 'expired';
    if (p.max_uses !== null && p.uses >= p.max_uses) return 'usedUp';
    if (p.starts_at && new Date(p.starts_at).getTime() > now) return 'scheduled';
    return 'on';
  };

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <p className='text-muted-foreground max-w-2xl text-sm'>{t('intro')}</p>
        {scope.canEdit && (
          <Button onClick={() => setEditing(null)}>
            <Icons.add aria-hidden />
            {t('new')}
          </Button>
        )}
      </div>
      {data.length === 0 ? (
        <Empty className='border'>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <Icons.discount />
            </EmptyMedia>
            <EmptyTitle>{t('emptyTitle')}</EmptyTitle>
            <EmptyDescription>{t('emptyDescription')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
          {data.map((p) => {
            const s = state(p);
            return (
              <li key={p.id}>
                <Card className='h-full gap-2 py-4'>
                  <CardContent className='space-y-2 px-4 text-sm'>
                    <div className='flex items-center justify-between gap-2'>
                      <span className='font-mono text-base font-semibold tracking-wider'>
                        {p.code}
                      </span>
                      <Badge variant={s === 'on' ? 'default' : 'secondary'}>
                        {t(`state.${s}`)}
                      </Badge>
                    </div>
                    <p className='font-medium'>
                      {p.discount_kind === 'percent'
                        ? t('percentOff', { value: p.discount_value })
                        : t('amountOff', { value: formatMoney(p.discount_value, p.currency) })}
                    </p>
                    {p.description && <p className='text-muted-foreground'>{p.description}</p>}
                    <p className='text-muted-foreground text-xs'>
                      {p.max_uses
                        ? t('usesOf', { uses: p.uses, max: p.max_uses })
                        : t('uses', { uses: p.uses })}
                      {p.ends_at &&
                        ` · ${t('until', { date: format.dateTime(new Date(p.ends_at), { dateStyle: 'medium' }) })}`}
                      {p.offers.length > 0 && ` · ${t('onOffers', { count: p.offers.length })}`}
                    </p>
                    {scope.canEdit && (
                      <Button size='sm' variant='outline' onClick={() => setEditing(p)}>
                        <Icons.edit aria-hidden />
                        {t('edit')}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      <Sheet open={editing !== undefined} onOpenChange={(open) => !open && setEditing(undefined)}>
        <SheetContent className='w-full overflow-y-auto sm:max-w-lg'>
          <SheetHeader>
            <SheetTitle>{editing ? t('editTitle') : t('newTitle')}</SheetTitle>
            <SheetDescription>{t('sheetDescription')}</SheetDescription>
          </SheetHeader>
          {editing !== undefined && (
            <PromoForm promo={editing} onDone={() => setEditing(undefined)} />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function PromoForm({ promo, onDone }: { promo: PromoCode | null; onDone: () => void }) {
  const scope = useSiteScope();
  const t = useTranslations('engage.promos');
  const tv = useTranslations('validation');
  const f = useFields();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const currency = promo?.currency ?? 'usd';

  const schema = useMemo(
    () =>
      z
        .object({
          code: z.string().regex(/^[A-Za-z0-9_-]{3,32}$/, t('codeInvalid')),
          description: f.text(160),
          kind: z.enum(['percent', 'amount']),
          value: f.amount({ required: true, max: 100000 }),
          offers: f.text(2000, { multiline: true }),
          maxUses: z.string().regex(/^(\d{1,7})?$/, tv('invalid')),
          startsAt: z.string(),
          endsAt: z.string(),
          active: z.boolean()
        })
        .superRefine((v, ctx) => {
          const n = Number(v.value);
          if (v.kind === 'percent' && (!Number.isInteger(n) || n < 1 || n > 100)) {
            ctx.addIssue({ code: 'custom', path: ['value'], message: t('percentInvalid') });
          }
          if (v.startsAt && v.endsAt && v.endsAt <= v.startsAt) {
            ctx.addIssue({ code: 'custom', path: ['endsAt'], message: t('endAfterStart') });
          }
        }),
    [f, t, tv]
  );

  const form = useAppForm({
    defaultValues: {
      code: promo?.code ?? '',
      description: promo?.description ?? '',
      kind: promo?.discount_kind ?? ('percent' as 'percent' | 'amount'),
      value: promo
        ? String(
            promo.discount_kind === 'percent'
              ? promo.discount_value
              : minorToMajor(promo.discount_value, currency)
          )
        : '',
      offers: (promo?.offers ?? []).join('\n'),
      maxUses: promo?.max_uses ? String(promo.max_uses) : '',
      startsAt: toLocalInput(promo?.starts_at ?? null),
      endsAt: toLocalInput(promo?.ends_at ?? null),
      active: promo?.active ?? true
    },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      const v = schema.parse(value);
      try {
        await savePromoCode(createClient(), scope.websiteId, promo?.id ?? null, {
          code: v.code.toUpperCase(),
          description: v.description || null,
          discount_kind: v.kind,
          discount_value:
            v.kind === 'percent' ? Number(v.value) : majorToMinor(Number(v.value), currency),
          currency,
          offers: v.offers
            .split('\n')
            .map((x) => x.trim())
            .filter(Boolean),
          max_uses: v.maxUses ? Number(v.maxUses) : null,
          starts_at: fromLocalInput(v.startsAt),
          ends_at: fromLocalInput(v.endsAt),
          active: v.active
        });
        toast.success(t('saved'));
        void queryClient.invalidateQueries({ queryKey: engageKeys.promos(scope.websiteId) });
        onDone();
      } catch (error) {
        const code =
          error instanceof AppError
            ? (error.cause as { code?: string } | undefined)?.code
            : undefined;
        toast.error(code === 'PT409' ? t('duplicate') : errorMessage(error));
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
      <FieldGroup>
        <form.AppField
          name='code'
          children={(field) => (
            <field.TextField
              label={t('code')}
              description={t('codeHint')}
              placeholder='BIENVENUE10'
              autoCapitalize='characters'
              maxLength={32}
              showCount={false}
              required
            />
          )}
        />
        <form.AppField
          name='description'
          children={(field) => <field.TextField label={t('description')} maxLength={160} />}
        />
        <div className='grid gap-4 sm:grid-cols-2'>
          <form.AppField
            name='kind'
            children={(field) => (
              <field.SelectField
                label={t('kind')}
                options={[
                  { value: 'percent', label: t('kinds.percent') },
                  {
                    value: 'amount',
                    label: t('kinds.amount', { currency: currency.toUpperCase() })
                  }
                ]}
              />
            )}
          />
          <form.AppField
            name='value'
            children={(field) => (
              <field.TextField
                label={t('value')}
                inputMode='decimal'
                maxLength={9}
                showCount={false}
                required
              />
            )}
          />
        </div>
        <form.AppField
          name='offers'
          children={(field) => (
            <field.TextareaField label={t('offers')} description={t('offersHint')} rows={3} />
          )}
        />
        <form.AppField
          name='maxUses'
          children={(field) => (
            <field.TextField
              label={t('maxUses')}
              description={t('maxUsesHint')}
              inputMode='numeric'
              maxLength={7}
              showCount={false}
            />
          )}
        />
        <div className='grid gap-4 sm:grid-cols-2'>
          <form.AppField
            name='startsAt'
            children={(field) => <field.TextField label={t('startsAt')} type='datetime-local' />}
          />
          <form.AppField
            name='endsAt'
            children={(field) => <field.TextField label={t('endsAt')} type='datetime-local' />}
          />
        </div>
        <form.AppField
          name='active'
          children={(field) => (
            <field.SwitchField label={t('active')} description={t('activeHint')} />
          )}
        />
      </FieldGroup>
      <SheetFooter className='flex-row justify-end gap-2 px-0'>
        <Button type='button' variant='outline' onClick={onDone}>
          {t('cancel')}
        </Button>
        <form.AppForm>
          <form.SubmitButton>{t('save')}</form.SubmitButton>
        </form.AppForm>
      </SheetFooter>
    </form>
  );
}

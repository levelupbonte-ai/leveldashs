'use client';
import { useFormatter, useTranslations } from 'next-intl';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { BillingStatus, BillingSummary } from '../api/types';
import { formatMoney } from '../lib/format';
import { DiscountBadge } from './discount-badge';

const STATUS_VARIANT: Record<BillingStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  active: 'default',
  trial: 'secondary',
  past_due: 'destructive',
  suspended: 'destructive'
};

/** Plan name, monthly price (never a made-up number), status, due date, discounts. */
export function CurrentPlanCard({ summary }: { summary: BillingSummary }) {
  const t = useTranslations('billing');
  const format = useFormatter();
  const money = summary.money;
  const requested = summary.pending_request
    ? summary.plans.find((p) => p.key === summary.pending_request?.plan_key)
    : null;
  const tagline = summary.plan.description || taglineFor(t, summary.plan.key);

  return (
    <Card className='h-full'>
      <CardHeader>
        <CardDescription className='flex items-center gap-2'>
          <Icons.billing className='size-4' aria-hidden />
          {t('plan.title')}
        </CardDescription>
        <CardTitle className='flex flex-wrap items-center gap-2 text-2xl'>
          {summary.plan.name}
          <Badge variant={STATUS_VARIANT[summary.status]}>{t(`status.${summary.status}`)}</Badge>
          {money?.price_state === 'custom' && <Badge variant='outline'>{t('plan.custom')}</Badge>}
        </CardTitle>
        {tagline && <p className='text-muted-foreground text-sm'>{tagline}</p>}
      </CardHeader>
      <CardContent className='space-y-4'>
        {money ? (
          <div className='space-y-1'>
            {money.price_state === 'unset' || money.price === null ? (
              <p className='text-lg font-medium'>{t('plan.priceUnset')}</p>
            ) : money.price_state === 'free' ? (
              <p className='text-3xl font-semibold tracking-tight'>{t('plan.free')}</p>
            ) : (
              <>
                <p
                  className={
                    money.subscription_discount
                      ? 'text-muted-foreground text-sm line-through'
                      : 'text-3xl font-semibold tracking-tight tabular-nums'
                  }
                >
                  {t('plan.perMonth', {
                    price: formatMoney(format.number, money.price, money.currency)
                  })}
                </p>
                {money.subscription_discount && money.price_after_discount !== null && (
                  <p className='text-3xl font-semibold tracking-tight tabular-nums'>
                    {t('plan.afterDiscount', {
                      price: formatMoney(format.number, money.price_after_discount, money.currency)
                    })}
                  </p>
                )}
              </>
            )}
            {money.next_due_date && (
              <p className='text-muted-foreground flex items-center gap-1.5 text-sm'>
                <Icons.calendar className='size-4' aria-hidden />
                {t('plan.nextDue', {
                  date: format.dateTime(new Date(`${money.next_due_date}T12:00:00`), {
                    dateStyle: 'long'
                  })
                })}
              </p>
            )}
          </div>
        ) : (
          <p className='text-muted-foreground text-sm'>{t('plan.membersHint')}</p>
        )}

        {money && money.discounts.length > 0 && (
          <div className='flex flex-wrap gap-2'>
            {money.discounts.map((d) => (
              <DiscountBadge key={d.id} discount={d} />
            ))}
          </div>
        )}

        {requested && (
          <div className='bg-muted/40 flex gap-3 rounded-lg border p-3 text-sm'>
            <Icons.clock className='text-muted-foreground mt-0.5 size-4 shrink-0' aria-hidden />
            <div>
              <p className='font-medium'>{t('plan.requested', { plan: requested.name })}</p>
              <p className='text-muted-foreground'>{t('plan.requestedHint')}</p>
            </div>
          </div>
        )}

        {money?.note && (
          <div className='rounded-lg border p-3 text-sm'>
            <p className='text-muted-foreground mb-1 text-xs font-medium'>{t('plan.noteTitle')}</p>
            <p className='whitespace-pre-wrap'>{money.note}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const TAGLINES = ['free', 'starter', 'pro', 'business'] as const;

/** Standard description of a seeded plan, in the viewer's language. */
export function taglineFor(t: ReturnType<typeof useTranslations<'billing'>>, key: string) {
  return (TAGLINES as readonly string[]).includes(key)
    ? t(`tagline.${key as (typeof TAGLINES)[number]}`)
    : null;
}

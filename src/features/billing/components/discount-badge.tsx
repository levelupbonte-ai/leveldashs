'use client';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import type { ActiveDiscount } from '../api/types';
import { formatMoney } from '../lib/format';

type DiscountLike = Pick<ActiveDiscount, 'label' | 'kind' | 'value' | 'currency'>;

/** "Partner −20%" / "Launch −$50.00". */
export function useDiscountText() {
  const t = useTranslations('billing.discounts');
  const format = useFormatter();
  return useCallback(
    (d: DiscountLike) =>
      d.kind === 'percent'
        ? t('percent', { label: d.label, value: d.value })
        : t('fixed', {
            label: d.label,
            amount: formatMoney(format.number, d.value, d.currency ?? 'usd')
          }),
    [t, format]
  );
}

export function DiscountBadge({ discount }: { discount: ActiveDiscount }) {
  const t = useTranslations('billing.discounts');
  const format = useFormatter();
  const text = useDiscountText();
  return (
    <Badge variant='secondary' className='gap-1'>
      <Icons.discount className='size-3.5' aria-hidden />
      {text(discount)}
      {discount.ends_at && (
        <span className='text-muted-foreground font-normal'>
          {' · '}
          {t('until', {
            date: format.dateTime(new Date(discount.ends_at), {
              dateStyle: 'medium'
            })
          })}
        </span>
      )}
    </Badge>
  );
}

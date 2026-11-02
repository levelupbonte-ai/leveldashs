'use client';

import { useTranslations } from 'next-intl';
import { charCountTone } from '@/lib/char-count';
import { cn } from '@/lib/utils';

/**
 * "42 / 160" under a text field: muted, amber near the limit, red past it.
 * Screen readers get "42 of 160 characters used" through the field's
 * `aria-describedby`, and are told when the limit gets close.
 */
export function CharCounter({
  id,
  count,
  max,
  unit = 'characters',
  className
}: {
  id: string;
  count: number;
  max: number;
  /** What is counted (screen reader text). */
  unit?: 'characters' | 'items';
  className?: string;
}) {
  const t = useTranslations('forms');
  const tone = charCountTone(count, max);
  return (
    <p
      id={id}
      data-tone={tone}
      aria-live={tone === 'normal' ? 'off' : 'polite'}
      className={cn(
        'text-muted-foreground ml-auto shrink-0 text-xs tabular-nums',
        tone === 'near' && 'text-amber-700 dark:text-amber-400',
        tone === 'over' && 'text-destructive font-medium',
        className
      )}
    >
      <span aria-hidden='true'>
        {count} / {max}
      </span>
      <span className='sr-only'>
        {t(unit === 'items' ? 'itemCount' : 'charCount', { count, max })}
      </span>
    </p>
  );
}

'use client';

import { useQueryStates } from 'nuqs';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RANGE_DAYS, type RangeDays } from '../api/types';
import { rangeParser } from '../lib/range';

/** `?range=` of the page (7 / 30 / 90 days). The previous data stays on screen while the next range loads. */
export function useRange() {
  const [isPending, startTransition] = useTransition();
  const [{ range }, setParams] = useQueryStates(
    { range: rangeParser },
    { startTransition, shallow: true, history: 'replace' }
  );
  return { range, setRange: (value: RangeDays) => setParams({ range: value }), isPending };
}

export function RangeTabs({
  value,
  onChange
}: {
  value: RangeDays;
  onChange: (value: RangeDays) => void;
}) {
  const t = useTranslations('insights.range');
  return (
    <Tabs value={String(value)} onValueChange={(v) => onChange(Number(v) as RangeDays)}>
      <TabsList aria-label={t('label')}>
        {RANGE_DAYS.map((d) => (
          <TabsTrigger key={d} value={String(d)}>
            {t('days', { count: d })}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

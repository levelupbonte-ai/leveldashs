'use client';

import { useFormatter, useTimeZone, useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';
import { dayKey } from '../lib/grouping';

const DAY_MS = 86_400_000;

/** Times and day labels in the dashboard time zone (docs/i18n.md). */
export function useChatFormat() {
  const format = useFormatter();
  const timeZone = useTimeZone() ?? 'America/Toronto';
  const t = useTranslations('chat.thread');

  const time = useCallback(
    (iso: string) => format.dateTime(new Date(iso), { hour: 'numeric', minute: '2-digit' }),
    [format]
  );

  /** Conversation list: time today, weekday this week, else a short date. */
  const listTime = useCallback(
    (iso: string) => {
      const now = Date.now();
      const date = new Date(iso);
      if (dayKey(iso, timeZone) === dayKey(new Date(now).toISOString(), timeZone)) return time(iso);
      if (now - date.getTime() < 6 * DAY_MS) return format.dateTime(date, { weekday: 'short' });
      return format.dateTime(date, { day: 'numeric', month: 'short' });
    },
    [format, time, timeZone]
  );

  /** Separator between days of a thread. */
  const dayLabel = useCallback(
    (day: string) => {
      const today = dayKey(new Date().toISOString(), timeZone);
      const yesterday = dayKey(new Date(Date.now() - DAY_MS).toISOString(), timeZone);
      if (day === today) return t('today');
      if (day === yesterday) return t('yesterday');
      return format.dateTime(new Date(`${day}T12:00:00Z`), {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        timeZone: 'UTC'
      });
    },
    [format, t, timeZone]
  );

  return useMemo(
    () => ({ time, listTime, dayLabel, timeZone }),
    [time, listTime, dayLabel, timeZone]
  );
}

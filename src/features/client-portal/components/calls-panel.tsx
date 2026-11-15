'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useErrorMessage } from '@/hooks/use-error-message';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { useSiteScope } from '@/features/site/components/use-site-scope';
import { portalCallsQueryOptions, portalKeys } from '../api/queries';
import { addPortalCallSlots, cancelPortalCallSlot, updatePortalCall } from '../api/service';
import type { PortalCallBooking, PortalCallSlot } from '../api/types';

const TIME_RE = /^([01]?\d|2[0-3])[:hH]([0-5]\d)$/;

/** "09:00, 10h30 14:00" -> ISO instants of that local day (the team's time zone). */
export function slotInstants(date: string, times: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  const [y, m, d] = date.split('-').map(Number);
  return times
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map((t) => TIME_RE.exec(t.trim()))
    .filter((x): x is RegExpExecArray => x !== null)
    .map((x) => new Date(y, m - 1, d, Number(x[1]), Number(x[2])).toISOString());
}

/**
 * Calls with members: the team opens slots (one-to-one calls, or a Premium
 * group meeting on Zoom), sees who booked, calls the member at the number
 * they gave (the team's own number is never shown) or adds the video link,
 * and marks each call done or missed.
 */
export function CallsPanel() {
  const scope = useSiteScope();
  const t = useTranslations('clientPortal.calls');
  const format = useFormatter();
  const { data, isPending } = useQuery(portalCallsQueryOptions(createClient(), scope.websiteId));
  const slots = data ?? [];
  const [now] = useState(() => Date.now());

  const upcoming = slots.filter(
    (s) => !s.canceled_at && new Date(s.starts_at).getTime() > now - 2 * 3600e3
  );
  const past = slots.filter(
    (s) => !s.canceled_at && new Date(s.starts_at).getTime() <= now - 2 * 3600e3
  );
  const booked = upcoming.filter((s) => s.bookings.some((b) => b.status === 'booked')).length;

  const dayMap = new Map<string, PortalCallSlot[]>();
  for (const s of upcoming) {
    const key = format.dateTime(new Date(s.starts_at), { dateStyle: 'full' });
    dayMap.set(key, [...(dayMap.get(key) ?? []), s]);
  }
  const days = [...dayMap];

  return (
    <div className='grid gap-4 lg:grid-cols-[minmax(0,22rem)_1fr]'>
      <AddSlots />
      <div className='space-y-4'>
        <div className='flex flex-wrap items-center gap-2 text-sm'>
          <Badge variant='secondary'>
            {t('stats.open', {
              count: upcoming.filter(
                (s) => s.kind === 'one' && !s.bookings.some((b) => b.status !== 'canceled')
              ).length
            })}
          </Badge>
          <Badge>{t('stats.booked', { count: booked })}</Badge>
          <span className='text-muted-foreground text-xs'>{t('privacy')}</span>
        </div>
        {isPending && <Skeleton className='h-40 w-full' />}
        {!isPending && upcoming.length === 0 && (
          <div className='text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm'>
            {t('empty')}
          </div>
        )}
        {days.map(([day, list]) => (
          <section key={day} className='space-y-2'>
            <h3 className='text-muted-foreground text-xs font-semibold tracking-wide uppercase'>
              {day}
            </h3>
            <ul className='space-y-2'>
              {list.map((s) => (
                <SlotRow key={s.id} slot={s} />
              ))}
            </ul>
          </section>
        ))}
        {past.some((s) => s.bookings.length > 0) && (
          <details className='rounded-lg border p-3'>
            <summary className='cursor-pointer text-sm font-medium'>{t('past')}</summary>
            <ul className='mt-3 space-y-2'>
              {past
                .filter((s) => s.bookings.length > 0)
                .toReversed()
                .map((s) => (
                  <SlotRow key={s.id} slot={s} />
                ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}

function AddSlots() {
  const scope = useSiteScope();
  const t = useTranslations('clientPortal.calls.add');
  const tv = useTranslations('validation');
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const schema = useMemo(
    () =>
      z
        .object({
          kind: z.enum(['one', 'meeting']),
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, tv('required')),
          times: z.string().max(400),
          minutes: z.enum(['20', '30', '45', '60']),
          title: z.string().max(120),
          capacity: z.string().regex(/^\d{0,3}$/),
          link: z.string().max(500)
        })
        .superRefine((v, ctx) => {
          if (slotInstants(v.date, v.times).length === 0) {
            ctx.addIssue({ code: 'custom', path: ['times'], message: t('timesInvalid') });
          }
          if (v.link && !v.link.startsWith('https://')) {
            ctx.addIssue({ code: 'custom', path: ['link'], message: t('linkInvalid') });
          }
        }),
    [t, tv]
  );
  const form = useAppForm({
    defaultValues: {
      kind: 'one' as 'one' | 'meeting',
      date: '',
      times: '',
      minutes: '20' as '20' | '30' | '45' | '60',
      title: '',
      capacity: '50',
      link: ''
    },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      const v = schema.parse(value);
      try {
        const out = await addPortalCallSlots(createClient(), scope.websiteId, {
          starts: slotInstants(v.date, v.times),
          minutes: Number(v.minutes),
          kind: v.kind,
          title: v.kind === 'meeting' ? v.title || undefined : undefined,
          capacity: v.kind === 'meeting' && v.capacity ? Number(v.capacity) : undefined,
          link: v.link || undefined
        });
        toast.success(t('added', { count: out.added }));
        form.reset({ ...value, times: '' });
        void queryClient.invalidateQueries({ queryKey: portalKeys.calls(scope.websiteId) });
      } catch (error) {
        toast.error(errorMessage(error));
      }
    }
  });

  return (
    <Card className='h-fit'>
      <CardHeader>
        <CardTitle className='text-base'>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
          className='space-y-3'
        >
          <form.AppField
            name='kind'
            children={(field) => (
              <field.SelectField
                label={t('kind')}
                options={[
                  { value: 'one', label: t('kindOne') },
                  { value: 'meeting', label: t('kindMeeting') }
                ]}
              />
            )}
          />
          <form.AppField
            name='date'
            children={(field) => <field.TextField label={t('date')} type='date' />}
          />
          <form.AppField
            name='times'
            children={(field) => (
              <field.TextField
                label={t('times')}
                description={t('timesHint')}
                placeholder='09:00, 10:30, 14:00'
              />
            )}
          />
          <form.AppField
            name='minutes'
            children={(field) => (
              <field.SelectField
                label={t('minutes')}
                options={['20', '30', '45', '60'].map((m) => ({
                  value: m,
                  label: t('minutesN', { n: Number(m) })
                }))}
              />
            )}
          />
          <form.Subscribe selector={(s) => s.values.kind}>
            {(kind) =>
              kind === 'meeting' && (
                <>
                  <form.AppField
                    name='title'
                    children={(field) => (
                      <field.TextField label={t('meetingTitle')} maxLength={120} />
                    )}
                  />
                  <form.AppField
                    name='capacity'
                    children={(field) => (
                      <field.TextField label={t('capacity')} inputMode='numeric' maxLength={3} />
                    )}
                  />
                </>
              )
            }
          </form.Subscribe>
          <form.AppField
            name='link'
            children={(field) => (
              <field.TextField
                label={t('link')}
                description={t('linkHint')}
                placeholder='https://zoom.us/j/…'
                maxLength={500}
              />
            )}
          />
          <form.AppForm>
            <form.SubmitButton>{t('submit')}</form.SubmitButton>
          </form.AppForm>
        </form>
      </CardContent>
    </Card>
  );
}

function SlotRow({ slot }: { slot: PortalCallSlot }) {
  const scope = useSiteScope();
  const t = useTranslations('clientPortal.calls');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: portalKeys.calls(scope.websiteId) });
  const active = slot.bookings.filter((b) => b.status !== 'canceled');
  const time = format.dateTime(new Date(slot.starts_at), { timeStyle: 'short' });

  const cancelSlot = async () => {
    try {
      await cancelPortalCallSlot(createClient(), slot.id);
      toast.success(t('slotCanceled'));
      refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <li className='rounded-lg border p-3'>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='bg-muted inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-semibold tabular-nums'>
          <Icons.clock className='size-3.5' aria-hidden />
          {time}
        </span>
        <span className='text-muted-foreground text-xs'>
          {t('minutesShort', { n: slot.minutes })}
        </span>
        {slot.kind === 'meeting' ? (
          <Badge variant='outline'>
            <Icons.video aria-hidden /> {slot.title} ·{' '}
            {t('participants', { count: active.length, capacity: slot.capacity })}
          </Badge>
        ) : active.length === 0 ? (
          <Badge variant='secondary'>{t('free')}</Badge>
        ) : null}
        {(slot.kind === 'meeting' || active.length === 0) && (
          <Button
            variant='ghost'
            size='sm'
            className='ml-auto h-7 text-xs'
            onClick={() => void cancelSlot()}
          >
            <Icons.close aria-hidden /> {t('cancelSlot')}
          </Button>
        )}
      </div>
      {slot.kind === 'one' &&
        slot.bookings.map((b) => <BookingRow key={b.id} booking={b} onChange={refresh} />)}
      {slot.kind === 'meeting' && slot.link && (
        <p className='text-muted-foreground mt-2 truncate text-xs'>
          {t('meetingLink')}{' '}
          <a className='underline' href={slot.link} target='_blank' rel='noreferrer'>
            {slot.link}
          </a>
        </p>
      )}
    </li>
  );
}

function BookingRow({
  booking: b,
  onChange
}: {
  booking: PortalCallBooking;
  onChange: () => void;
}) {
  const t = useTranslations('clientPortal.calls');
  const errorMessage = useErrorMessage();
  const [link, setLink] = useState(b.link ?? '');
  const video = b.mode === 'video';

  const update = async (
    input: { status?: PortalCallBooking['status']; link?: string },
    done: string
  ) => {
    try {
      await updatePortalCall(createClient(), b.id, input);
      toast.success(done);
      onChange();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className={cn('mt-3 space-y-2 border-t pt-3', b.status === 'canceled' && 'opacity-60')}>
      <div className='flex flex-wrap items-center gap-2 text-sm'>
        <span className='font-medium'>{b.name || b.email}</span>
        <Badge variant='outline'>
          {video ? <Icons.video aria-hidden /> : <Icons.phone aria-hidden />}
          {t(`platform.${b.platform}`)}
        </Badge>
        <Badge variant={b.status === 'booked' ? 'default' : 'secondary'}>
          {t(`status.${b.status}`)}
        </Badge>
        {b.canceled_by && (
          <span className='text-muted-foreground text-xs'>{t(`canceledBy.${b.canceled_by}`)}</span>
        )}
      </div>
      {b.phone && (
        <p className='text-sm'>
          <span className='text-muted-foreground'>{t('memberNumber')} </span>
          <a className='font-medium underline' href={`tel:${b.phone.replace(/\s/g, '')}`}>
            {b.phone}
          </a>
          {b.platform === 'whatsapp' && (
            <a
              className='text-muted-foreground ml-2 text-xs underline'
              href={`https://wa.me/${b.phone.replace(/\D/g, '')}`}
              target='_blank'
              rel='noreferrer'
            >
              {t('openWhatsapp')}
            </a>
          )}
        </p>
      )}
      {b.topic && <p className='text-muted-foreground text-sm whitespace-pre-wrap'>{b.topic}</p>}
      {video && b.status === 'booked' && (
        <div className='flex gap-2'>
          <Input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder={
              b.platform === 'meet' ? 'https://meet.google.com/…' : 'https://zoom.us/j/…'
            }
            aria-label={t('videoLink')}
            className='h-8'
          />
          <Button
            size='sm'
            variant='outline'
            className='h-8'
            onClick={() => void update({ link }, t('linkSaved'))}
          >
            {t('saveLink')}
          </Button>
        </div>
      )}
      {b.status === 'booked' && (
        <div className='flex flex-wrap gap-2'>
          <Button
            size='sm'
            className='h-7 text-xs'
            onClick={() => void update({ status: 'done' }, t('marked'))}
          >
            <Icons.check aria-hidden /> {t('markDone')}
          </Button>
          <Button
            size='sm'
            variant='outline'
            className='h-7 text-xs'
            onClick={() => void update({ status: 'missed' }, t('marked'))}
          >
            {t('markMissed')}
          </Button>
          <Button
            size='sm'
            variant='ghost'
            className='h-7 text-xs'
            onClick={() => void update({ status: 'canceled' }, t('marked'))}
          >
            {t('cancelCall')}
          </Button>
        </div>
      )}
    </div>
  );
}

'use client';

import { useQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { createClient } from '@/lib/supabase/client';
import { useSiteScope } from '@/features/site/components/use-site-scope';
import { portalQuestionnairesQueryOptions } from '../api/queries';
import type { PortalQuestionnaire } from '../api/types';
import { ProfileDetails } from './profile-card';

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Name, destination and plan of a questionnaire, from its own fields. */
function summary(q: PortalQuestionnaire) {
  const p = q.profile;
  const readable = p.readable as { header?: { label: string; value: string }[] } | undefined;
  const header = readable?.header ?? [];
  const pick = (labels: string[]) => header.find((h) => labels.includes(h.label))?.value ?? '';
  return {
    name: text(p.fullName) || pick(['Nom', 'Name']) || q.email || '',
    destination: pick(['Destination']) || text(p.destinationCountry),
    plan: pick(['Formule', 'Plan']) || text(p.tier),
    phone: text(p.phone)
  };
}

/**
 * Every questionnaire filled in on the website before payment, newest first:
 * members and prospects who have not paid yet (kept 30 days), with their
 * answers as they gave them.
 */
export function QuestionnairesView() {
  const scope = useSiteScope();
  const t = useTranslations('clientPortal.questionnaires');
  const format = useFormatter();
  const { data, isPending } = useQuery(
    portalQuestionnairesQueryOptions(createClient(), scope.websiteId)
  );
  const [open, setOpen] = useState<PortalQuestionnaire | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'members' | 'prospects'>('all');

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data ?? []).filter((x) => {
      if (filter === 'members' && !x.customer_id) return false;
      if (filter === 'prospects' && x.customer_id) return false;
      if (!q) return true;
      const s = summary(x);
      return [s.name, s.destination, s.phone, x.email ?? ''].some((v) =>
        v.toLowerCase().includes(q)
      );
    });
  }, [data, search, filter]);

  const prospects = (data ?? []).filter((x) => !x.customer_id).length;

  return (
    <div className='space-y-4'>
      <p className='text-muted-foreground max-w-2xl text-sm'>{t('intro')}</p>
      <div className='flex flex-wrap items-center gap-2'>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('search')}
          aria-label={t('search')}
          className='max-w-xs'
        />
        {(['all', 'members', 'prospects'] as const).map((f) => (
          <button
            key={f}
            type='button'
            onClick={() => setFilter(f)}
            className={`rounded-full border px-3 py-1 text-sm ${filter === f ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground'}`}
            aria-pressed={filter === f}
          >
            {t(`filters.${f}`)}
            {f === 'prospects' && prospects > 0 && ` (${prospects})`}
          </button>
        ))}
      </div>

      {isPending ? (
        <Skeleton className='h-32 w-full' />
      ) : list.length === 0 ? (
        <Empty className='border'>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <Icons.forms />
            </EmptyMedia>
            <EmptyTitle>{t('emptyTitle')}</EmptyTitle>
            <EmptyDescription>{t('emptyDescription')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
          {list.map((q) => {
            const s = summary(q);
            return (
              <li key={q.id}>
                <button
                  type='button'
                  onClick={() => setOpen(q)}
                  className='w-full text-left'
                  aria-label={t('open', { name: s.name })}
                >
                  <Card className='hover:border-primary/40 h-full gap-2 py-4 transition-colors'>
                    <CardContent className='space-y-1.5 px-4 text-sm'>
                      <div className='flex items-start justify-between gap-2'>
                        <p className='truncate font-semibold'>{s.name || t('noName')}</p>
                        <Badge variant={q.customer_id ? 'default' : 'secondary'}>
                          {q.customer_id
                            ? q.member
                              ? t('member')
                              : t('memberEnded')
                            : t('prospect')}
                        </Badge>
                      </div>
                      {(s.destination || s.plan) && (
                        <p className='text-muted-foreground truncate'>
                          {[s.destination, s.plan].filter(Boolean).join(' · ')}
                        </p>
                      )}
                      <p className='text-muted-foreground truncate text-xs'>
                        {[q.email, s.phone].filter(Boolean).join(' · ')}
                      </p>
                      <p className='text-muted-foreground text-xs'>
                        {t('filled', {
                          date: format.dateTime(new Date(q.created_at), {
                            dateStyle: 'medium',
                            timeStyle: 'short'
                          })
                        })}
                      </p>
                    </CardContent>
                  </Card>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent className='w-full overflow-y-auto sm:max-w-lg'>
          <SheetHeader>
            <SheetTitle>{open ? summary(open).name || t('noName') : ''}</SheetTitle>
            <SheetDescription>
              {open &&
                (open.customer_id ? t('sheetMember') : t('sheetProspect')) +
                  ' · ' +
                  t('filled', {
                    date: format.dateTime(new Date(open.created_at), { dateStyle: 'medium' })
                  })}
            </SheetDescription>
          </SheetHeader>
          <div className='px-4 pb-6'>{open && <ProfileDetails profile={open.profile} />}</div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

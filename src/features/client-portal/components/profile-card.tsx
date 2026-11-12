'use client';

import { useQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { createClient } from '@/lib/supabase/client';
import { useSiteScope } from '@/features/site/components/use-site-scope';
import { portalProfileQueryOptions } from '../api/queries';

/** "destinationCountry" -> "Destination country". */
function humanize(key: string) {
  const s = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function show(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (Array.isArray(value)) return value.map(show).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => (show(v) ? `${humanize(k)}: ${show(v)}` : ''))
      .filter(Boolean)
      .join(' · ');
  }
  return String(value);
}

/**
 * The answers the member gave on the website before paying (their dossier),
 * shown as label / value. Free-form: each website sends its own fields.
 */
export function ProfileCard({ customerId }: { customerId: string }) {
  const scope = useSiteScope();
  const t = useTranslations('clientPortal.profile');
  const format = useFormatter();
  const { data } = useQuery(portalProfileQueryOptions(createClient(), scope.websiteId, customerId));
  const profile = data?.profile;
  const rows = profile
    ? Object.entries(profile)
        .filter(([k]) => k !== 'updatedAt')
        .flatMap(([k, v]) =>
          k === 'answers' && v && typeof v === 'object' && !Array.isArray(v)
            ? Object.entries(v as Record<string, unknown>)
            : [[k, v] as [string, unknown]]
        )
        .map(([k, v]) => [humanize(k), show(v)] as const)
        .filter(([, v]) => v)
        .slice(0, 60)
    : [];

  return (
    <Collapsible className='bg-muted/40 rounded-lg border'>
      <CollapsibleTrigger
        render={<Button variant='ghost' className='w-full justify-between px-3' />}
      >
        <span className='flex items-center gap-2'>
          <Icons.user className='size-4' aria-hidden />
          {t('title')}
        </span>
        <Icons.chevronDown className='size-4' aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent className='max-h-64 overflow-y-auto px-3 pb-3 text-sm'>
        {rows.length === 0 ? (
          <p className='text-muted-foreground'>{t('empty')}</p>
        ) : (
          <>
            <dl className='grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-3 gap-y-1'>
              {rows.map(([k, v], i) => (
                <div key={`${k}-${i}`} className='contents'>
                  <dt className='text-muted-foreground truncate'>{k}</dt>
                  <dd className='break-words'>{v}</dd>
                </div>
              ))}
            </dl>
            {data?.updated_at && (
              <p className='text-muted-foreground mt-2 text-xs'>
                {t('updated', {
                  date: format.dateTime(new Date(data.updated_at), { dateStyle: 'medium' })
                })}
              </p>
            )}
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

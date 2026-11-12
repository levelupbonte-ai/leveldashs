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

interface Readable {
  header?: { label: string; value: string }[];
  sections?: { title: string; rows: { q: string; a: string }[] }[];
}

function readableOf(profile: Record<string, unknown> | null | undefined): Readable | null {
  const r = profile?.readable as Readable | undefined;
  return r && (Array.isArray(r.header) || Array.isArray(r.sections)) ? r : null;
}

/** label / value rows of a dossier without the website's own wording. */
function rawRows(profile: Record<string, unknown>) {
  return Object.entries(profile)
    .filter(([k]) => !['updatedAt', 'readable', 'offerId', 'amountCents'].includes(k))
    .flatMap(([k, v]) =>
      k === 'answers' && v && typeof v === 'object' && !Array.isArray(v)
        ? Object.entries(v as Record<string, unknown>)
        : [[k, v] as [string, unknown]]
    )
    .map(([k, v]) => [humanize(k), show(v)] as const)
    .filter(([, v]) => v)
    .slice(0, 80);
}

/**
 * A dossier as the member filled it in: the questions and answers in words
 * when the website sent them, else label / value. Free-form: each website
 * sends its own fields.
 */
export function ProfileDetails({
  profile,
  note
}: {
  profile: Record<string, unknown> | null | undefined;
  note?: string | null;
}) {
  const t = useTranslations('clientPortal.profile');
  const readable = readableOf(profile);
  const rows = profile && !readable ? rawRows(profile) : [];
  return (
    <div className='space-y-4 text-sm'>
      {note && (
        <div>
          <p className='text-muted-foreground mb-1 text-xs font-medium'>{t('note')}</p>
          <p className='whitespace-pre-wrap'>{note}</p>
        </div>
      )}
      {readable ? (
        <>
          {!!readable.header?.length && (
            <dl className='grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-3 gap-y-1.5'>
              {readable.header.map((h) => (
                <div key={h.label} className='contents'>
                  <dt className='text-muted-foreground'>{h.label}</dt>
                  <dd className='font-medium break-words'>{h.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {readable.sections?.map((s) => (
            <section key={s.title} className='space-y-2'>
              <h4 className='font-semibold'>{s.title}</h4>
              <dl className='space-y-2'>
                {s.rows.map((r, i) => (
                  <div key={i}>
                    <dt className='text-muted-foreground'>{r.q}</dt>
                    <dd className='font-medium break-words'>{r.a}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </>
      ) : rows.length ? (
        <dl className='grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-3 gap-y-1'>
          {rows.map(([k, v], i) => (
            <div key={`${k}-${i}`} className='contents'>
              <dt className='text-muted-foreground truncate'>{k}</dt>
              <dd className='break-words'>{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        !note && <p className='text-muted-foreground'>{t('empty')}</p>
      )}
    </div>
  );
}

/** The member's dossier in the conversation sheet (folded). */
export function ProfileCard({ customerId }: { customerId: string }) {
  const scope = useSiteScope();
  const t = useTranslations('clientPortal.profile');
  const format = useFormatter();
  const { data } = useQuery(portalProfileQueryOptions(createClient(), scope.websiteId, customerId));
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
      <CollapsibleContent className='max-h-72 overflow-y-auto px-3 pb-3'>
        <ProfileDetails profile={data?.profile} note={data?.note} />
        {data?.updated_at && (
          <p className='text-muted-foreground mt-2 text-xs'>
            {t('updated', {
              date: format.dateTime(new Date(data.updated_at), { dateStyle: 'medium' })
            })}
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

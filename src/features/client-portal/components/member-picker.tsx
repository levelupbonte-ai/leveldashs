'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Icons } from '@/components/icons';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { useSiteScope } from '@/features/site/components/use-site-scope';
import { portalInboxQueryOptions } from '../api/queries';
import { memberGroups, regionNamer } from '../lib/member-groups';

/**
 * Choose members one by one, or a smart group in one tap (dossier to redo,
 * destination country, same country and project); search by name, e-mail or
 * country. Used to publish to exactly these members.
 */
export function MemberPicker({
  value,
  onChange,
  invalid
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  invalid?: boolean;
}) {
  const t = useTranslations('clientPortal.publish.pick');
  const tg = useTranslations('clientPortal.inbox');
  const scope = useSiteScope();
  const locale = useLocale();
  const { data } = useQuery(portalInboxQueryOptions(createClient(), scope.websiteId));
  const [search, setSearch] = useState('');
  const regionName = useMemo(() => regionNamer(locale), [locale]);
  const members = useMemo(() => (data ?? []).filter((c) => c.status === 'active'), [data]);
  const groups = useMemo(
    () => memberGroups(members, regionName, tg('groups.redo')),
    [members, regionName, tg]
  );
  const selected = new Set(value);
  const q = search.trim().toLowerCase();
  const visible = members.filter(
    (c) =>
      !q ||
      [c.name, c.email, c.country ? regionName(c.country) : '', c.purpose]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
  );

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  };
  const addGroup = (ids: string[]) => {
    const all = ids.every((id) => selected.has(id));
    const next = new Set(selected);
    for (const id of ids) {
      if (all) next.delete(id);
      else next.add(id);
    }
    onChange([...next]);
  };

  return (
    <div className={cn('space-y-2 rounded-lg border p-3', invalid && 'border-destructive')}>
      <div className='flex items-center justify-between gap-2'>
        <p className='text-sm font-medium'>{t('title')}</p>
        <span className='text-muted-foreground text-xs'>
          {t('selected', { count: value.length })}
          {value.length > 0 && (
            <button
              type='button'
              className='hover:text-foreground ml-2 underline'
              onClick={() => onChange([])}
            >
              {t('clear')}
            </button>
          )}
        </span>
      </div>
      {groups.length > 0 && (
        <div className='flex flex-wrap gap-1.5'>
          {groups.map((g) => {
            const on = g.ids.every((id) => selected.has(id));
            return (
              <button
                key={g.key}
                type='button'
                aria-pressed={on}
                onClick={() => addGroup(g.ids)}
                className={cn(
                  'inline-flex h-7 items-center gap-1 rounded-lg border px-2 text-xs font-medium transition-colors',
                  on ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent'
                )}
              >
                {g.key === 'redo' ? (
                  <Icons.warning className='size-3' aria-hidden />
                ) : g.key.startsWith('country') ? (
                  <Icons.world className='size-3' aria-hidden />
                ) : (
                  <Icons.teams className='size-3' aria-hidden />
                )}
                {g.label}
                <span className='opacity-70'>{g.ids.length}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className='relative'>
        <Icons.search
          className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2'
          aria-hidden
        />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('search')}
          aria-label={t('search')}
          className='h-9 pl-8'
        />
      </div>
      <ul className='max-h-64 divide-y overflow-y-auto rounded-md border'>
        {visible.map((c) => (
          <li key={c.id}>
            <label
              htmlFor={`pick-${c.id}`}
              className='hover:bg-accent/50 flex cursor-pointer items-center gap-3 px-3 py-2 text-sm'
            >
              <Checkbox
                id={`pick-${c.id}`}
                checked={selected.has(c.id)}
                onCheckedChange={() => toggle(c.id)}
              />
              <span className='min-w-0 flex-1'>
                <span className='block truncate font-medium'>{c.name || c.email}</span>
                <span className='text-muted-foreground block truncate text-xs'>
                  {[c.country ? regionName(c.country) : null, c.purpose, c.name ? c.email : null]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
            </label>
          </li>
        ))}
        {visible.length === 0 && (
          <li className='text-muted-foreground px-3 py-4 text-center text-xs'>{t('none')}</li>
        )}
      </ul>
    </div>
  );
}

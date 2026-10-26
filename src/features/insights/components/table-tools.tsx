'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDebouncedCallback } from '@/hooks/use-debounced-callback';

/** Search field that updates the URL after a short pause. */
export function SearchBox({
  value,
  onChange,
  placeholder,
  label
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
}) {
  const [text, setText] = useState(value);
  const debounced = useDebouncedCallback(onChange, 350);
  return (
    <div className='relative w-full sm:max-w-xs'>
      <Icons.search
        className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2'
        aria-hidden
      />
      <Input
        type='search'
        value={text}
        maxLength={100}
        aria-label={label}
        placeholder={placeholder}
        className='h-9 pl-8'
        onChange={(e) => {
          setText(e.target.value);
          debounced(e.target.value);
        }}
      />
    </div>
  );
}

/** Previous / next pagination with "x–y of n". */
export function Pager({
  page,
  perPage,
  total,
  onPage
}: {
  page: number;
  perPage: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const t = useTranslations('insights.table');
  const pages = Math.max(1, Math.ceil(total / perPage));
  const from = total ? (page - 1) * perPage + 1 : 0;
  const to = Math.min(total, page * perPage);
  return (
    <div className='flex items-center justify-between gap-2 text-sm'>
      <span className='text-muted-foreground tabular-nums'>{t('range', { from, to, total })}</span>
      <div className='flex gap-2'>
        <Button
          variant='outline'
          size='sm'
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label={t('previous')}
        >
          <Icons.chevronLeft className='size-4' />
        </Button>
        <Button
          variant='outline'
          size='sm'
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          aria-label={t('next')}
        >
          <Icons.chevronRight className='size-4' />
        </Button>
      </div>
    </div>
  );
}

/** Column header that sorts (aria-sort on the th is set by the caller). */
export function SortButton({
  label,
  active,
  ascending,
  onClick
}: {
  label: string;
  active: boolean;
  ascending: boolean;
  onClick: () => void;
}) {
  const Icon = !active ? Icons.chevronsUpDown : ascending ? Icons.chevronUp : Icons.chevronDown;
  return (
    <button
      type='button'
      onClick={onClick}
      className='hover:text-foreground -ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 font-medium'
    >
      {label}
      <Icon className='size-3.5' aria-hidden />
    </button>
  );
}

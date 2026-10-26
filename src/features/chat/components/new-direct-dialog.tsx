'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Icons } from '@/components/icons';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { membersQueryOptions } from '../api/queries';
import { initials } from '../lib/message-text';

interface NewDirectDialogProps {
  db: SupabaseClient;
  organizationId: string;
  organizationName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (userId: string) => void;
  pending: boolean;
}

export function NewDirectDialog({
  db,
  organizationId,
  organizationName,
  open,
  onOpenChange,
  onPick,
  pending
}: NewDirectDialogProps) {
  const t = useTranslations('chat.newDirect');
  const [search, setSearch] = useState('');
  const members = useQuery({ ...membersQueryOptions(db, organizationId), enabled: open });

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (members.data ?? []).filter((m) => !q || (m.name ?? '').toLowerCase().includes(q));
  }, [members.data, search]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description', { org: organizationName })}</DialogDescription>
        </DialogHeader>
        <div className='relative'>
          <Icons.search
            className='text-muted-foreground/70 pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2'
            aria-hidden='true'
          />
          <Input
            type='search'
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('search')}
            aria-label={t('search')}
            maxLength={100}
            className='rounded-xl pl-10'
          />
        </div>
        <div className='max-h-80 min-h-24 overflow-y-auto'>
          {members.isPending ? (
            <div className='space-y-2'>
              <Skeleton className='h-12 w-full rounded-xl' />
              <Skeleton className='h-12 w-full rounded-xl' />
            </div>
          ) : (members.data ?? []).length === 0 ? (
            <p className='text-muted-foreground py-6 text-center text-sm'>{t('empty')}</p>
          ) : list.length === 0 ? (
            <p className='text-muted-foreground py-6 text-center text-sm'>{t('noMatch')}</p>
          ) : (
            <ul className='space-y-1'>
              {list.map((m) => (
                <li key={m.id}>
                  <button
                    type='button'
                    disabled={pending}
                    onClick={() => onPick(m.id)}
                    className='hover:bg-muted/60 focus-visible:ring-primary/50 flex w-full items-center gap-3 rounded-xl p-2 text-left focus-visible:ring-2 focus-visible:outline-none disabled:opacity-60'
                  >
                    <Avatar className='h-9 w-9 rounded-xl'>
                      {m.avatar ? <AvatarImage src={m.avatar} alt='' /> : null}
                      <AvatarFallback className='bg-primary/15 text-primary rounded-xl text-xs font-medium'>
                        {initials(m.name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className='min-w-0 flex-1'>
                      <span className='block truncate text-sm font-medium'>{m.name}</span>
                      <span className='text-muted-foreground block text-xs'>
                        {t(`roles.${m.role}`)}
                      </span>
                    </span>
                    <Icons.chevronRight
                      className='text-muted-foreground size-4'
                      aria-hidden='true'
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

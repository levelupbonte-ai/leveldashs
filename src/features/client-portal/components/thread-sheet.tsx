'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet';
import { useErrorMessage } from '@/hooks/use-error-message';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { useFields } from '@/lib/validation/use-fields';
import { useSiteScope } from '@/features/site/components/use-site-scope';
import { portalKeys, portalThreadQueryOptions } from '../api/queries';
import { replyToPortalCustomer } from '../api/service';
import type { PortalCustomer } from '../api/types';
import { useNudgeEmails } from './use-nudge-emails';

/** Message thread with one customer; opening it marks their messages as read. */
export function ThreadSheet({
  customer,
  onOpenChange
}: {
  customer: PortalCustomer | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('clientPortal.thread');
  return (
    <Sheet open={!!customer} onOpenChange={onOpenChange}>
      <SheetContent className='flex w-full flex-col sm:max-w-lg'>
        <SheetHeader>
          <SheetTitle>{customer?.name || customer?.email}</SheetTitle>
          <SheetDescription>{t('description')}</SheetDescription>
        </SheetHeader>
        {customer && <Thread customer={customer} />}
      </SheetContent>
    </Sheet>
  );
}

const QUICK_REPLIES = ['received', 'published', 'call'] as const;

function dayKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function Thread({ customer }: { customer: PortalCustomer }) {
  const scope = useSiteScope();
  const t = useTranslations('clientPortal.thread');
  const format = useFormatter();
  const f = useFields();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const nudge = useNudgeEmails();
  // Client-only data (opened on demand): useQuery, not prefetched. Refreshes
  // itself while the sheet is open so a reply from the member shows up.
  const { data, isPending } = useQuery({
    ...portalThreadQueryOptions(createClient(), scope.websiteId, customer.id),
    refetchInterval: 10 * 1000
  });
  const [today] = useState(() => dayKey(new Date().toISOString()));
  const end = useRef<HTMLDivElement>(null);
  const count = data?.length ?? 0;
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
    if (count) void queryClient.invalidateQueries({ queryKey: portalKeys.list(scope.websiteId) });
  }, [count, queryClient, scope.websiteId]);

  const schema = useMemo(() => z.object({ body: f.text(4000, { min: 1, multiline: true }) }), [f]);
  const form = useAppForm({
    defaultValues: { body: '' },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      try {
        await replyToPortalCustomer(createClient(), customer.id, schema.parse(value).body);
        nudge();
        form.reset();
        void queryClient.invalidateQueries({ queryKey: portalKeys.all(scope.websiteId) });
      } catch (error) {
        toast.error(errorMessage(error));
      }
    }
  });

  const lastOwn = data?.toReversed().find((m) => m.sender === 'owner');

  let lastDay = '';

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4'>
      <div className='min-h-0 flex-1 space-y-1.5 overflow-y-auto' aria-live='polite'>
        {isPending && <Skeleton className='h-24 w-full' />}
        {data?.length === 0 && <p className='text-muted-foreground text-sm'>{t('empty')}</p>}
        {data?.map((m) => {
          const key = dayKey(m.created_at);
          const separator = key !== lastDay;
          lastDay = key;
          const own = m.sender === 'owner';
          return (
            <div key={m.id} className='space-y-1.5'>
              {separator && (
                <p className='text-muted-foreground py-2 text-center text-xs font-medium'>
                  {key === today
                    ? t('today')
                    : format.dateTime(new Date(m.created_at), { dateStyle: 'full' })}
                </p>
              )}
              <div
                className={cn(
                  'w-fit max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap',
                  own
                    ? 'bg-primary text-primary-foreground ml-auto rounded-br-md'
                    : 'bg-muted rounded-bl-md'
                )}
              >
                <p className='break-words'>{m.body}</p>
                <p className='mt-1 text-right text-[11px] opacity-70'>
                  {format.dateTime(new Date(m.created_at), { timeStyle: 'short' })}
                  {own && m === lastOwn && ` · ${m.read_at ? t('seen') : t('sent')}`}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
        className='space-y-2'
      >
        <div className='flex flex-wrap gap-1.5'>
          {QUICK_REPLIES.map((k) => (
            <Button
              key={k}
              type='button'
              size='sm'
              variant='outline'
              className='h-7 rounded-full text-xs'
              onClick={() => form.setFieldValue('body', t(`quick.${k}`))}
            >
              {t(`quickLabel.${k}`)}
            </Button>
          ))}
        </div>
        <form.AppField
          name='body'
          children={(field) => (
            <field.TextareaField
              label={t('reply')}
              description={t('shortcut')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void form.handleSubmit();
                }
              }}
              rows={3}
              maxLength={4000}
            />
          )}
        />
        <form.AppForm>
          <form.SubmitButton disabled={customer.status !== 'active'}>{t('send')}</form.SubmitButton>
        </form.AppForm>
      </form>
    </div>
  );
}

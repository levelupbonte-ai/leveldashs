'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';
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

function Thread({ customer }: { customer: PortalCustomer }) {
  const scope = useSiteScope();
  const t = useTranslations('clientPortal.thread');
  const format = useFormatter();
  const f = useFields();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const nudge = useNudgeEmails();
  // Client-only data (opened on demand): useQuery, not prefetched.
  const { data, isPending } = useQuery(
    portalThreadQueryOptions(createClient(), scope.websiteId, customer.id)
  );
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
    if (data) void queryClient.invalidateQueries({ queryKey: portalKeys.list(scope.websiteId) });
  }, [data, queryClient, scope.websiteId]);

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

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4'>
      <div className='min-h-0 flex-1 space-y-2 overflow-y-auto' aria-live='polite'>
        {isPending && <Skeleton className='h-24 w-full' />}
        {data?.length === 0 && <p className='text-muted-foreground text-sm'>{t('empty')}</p>}
        {data?.map((m) => (
          <div
            key={m.id}
            className={cn(
              'max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap',
              m.sender === 'owner' ? 'bg-primary text-primary-foreground ml-auto' : 'bg-muted'
            )}
          >
            <p>{m.body}</p>
            <p className='mt-1 text-[11px] opacity-70'>
              {m.sender === 'owner' ? t('you') : customer.name || customer.email} ·{' '}
              {format.dateTime(new Date(m.created_at), { dateStyle: 'short', timeStyle: 'short' })}
            </p>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
        className='space-y-2'
      >
        <form.AppField
          name='body'
          children={(field) => <field.TextareaField label={t('reply')} rows={3} maxLength={4000} />}
        />
        <form.AppForm>
          <form.SubmitButton disabled={customer.status !== 'active'}>{t('send')}</form.SubmitButton>
        </form.AppForm>
      </form>
    </div>
  );
}

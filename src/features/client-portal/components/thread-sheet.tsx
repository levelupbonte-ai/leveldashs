'use client';

import { useStore } from '@tanstack/react-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
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
import { useVisualViewport } from '@/hooks/use-visual-viewport';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { useFields } from '@/lib/validation/use-fields';
import { useSiteScope } from '@/features/site/components/use-site-scope';
import { portalKeys, portalThreadQueryOptions } from '../api/queries';
import { answerPortalHandoff, replyToPortalCustomer, savePortalDraft } from '../api/service';
import type { PortalCustomer, PortalInboxEntry, PortalMessage } from '../api/types';
import { ProfileCard } from './profile-card';
import { useNudgeEmails } from './use-nudge-emails';

/** Who the thread is with (from the customer list or the inbox). */
export type ThreadCustomer = Pick<PortalCustomer, 'id' | 'name' | 'email' | 'status'>;

/** Message thread with one customer; opening it marks their messages as read. */
export function ThreadSheet({
  customer,
  onOpenChange
}: {
  customer: ThreadCustomer | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('clientPortal.thread');
  // Phones: the panel follows the visible area so the keyboard never covers the reply box.
  const visible = useVisualViewport(!!customer);
  return (
    <Sheet open={!!customer} onOpenChange={onOpenChange}>
      <SheetContent
        className='flex w-full flex-col gap-3 sm:max-w-lg'
        style={visible ? { top: visible.top, height: visible.height, bottom: 'auto' } : undefined}
      >
        <SheetHeader>
          <SheetTitle>{customer?.name || customer?.email}</SheetTitle>
          <SheetDescription>{t('description')}</SheetDescription>
        </SheetHeader>
        {customer && <Thread key={customer.id} customer={customer} keyboard={!!visible} />}
      </SheetContent>
    </Sheet>
  );
}

const QUICK_REPLIES = ['received', 'published', 'call'] as const;

function dayKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function Thread({ customer, keyboard }: { customer: ThreadCustomer; keyboard: boolean }) {
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
    if (count) {
      void queryClient.invalidateQueries({ queryKey: portalKeys.list(scope.websiteId) });
      void queryClient.invalidateQueries({ queryKey: portalKeys.inbox(scope.websiteId) });
    }
  }, [count, queryClient, scope.websiteId]);

  // Answering a question sent from the AI assistant: the reply is marked validated.
  const [replyTo, setReplyTo] = useState<PortalMessage | null>(null);

  const schema = useMemo(() => z.object({ body: f.text(4000, { min: 1, multiline: true }) }), [f]);
  // The team's unsent reply, kept between visits (Drafts folder of the inbox).
  const [savedDraft] = useState(
    () =>
      queryClient
        .getQueryData<PortalInboxEntry[]>(portalKeys.inbox(scope.websiteId))
        ?.find((c) => c.id === customer.id)?.draft ?? ''
  );
  const form = useAppForm({
    defaultValues: { body: savedDraft },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      try {
        const body = schema.parse(value).body;
        if (replyTo) await answerPortalHandoff(createClient(), replyTo.id, body);
        else await replyToPortalCustomer(createClient(), customer.id, body);
        nudge();
        draft.current = '';
        form.reset({ body: '' });
        setReplyTo(null);
        void queryClient.invalidateQueries({ queryKey: portalKeys.all(scope.websiteId) });
      } catch (error) {
        toast.error(errorMessage(error));
      }
    }
  });

  const body = useStore(form.store, (state) => state.values.body);
  const draft = useRef(savedDraft);
  useEffect(() => {
    if (body.trim() === draft.current.trim()) return;
    const timer = setTimeout(() => {
      draft.current = body;
      savePortalDraft(createClient(), customer.id, body)
        .then(() => queryClient.invalidateQueries({ queryKey: portalKeys.inbox(scope.websiteId) }))
        .catch(() => undefined);
    }, 1200);
    return () => clearTimeout(timer);
  }, [body, customer.id, queryClient, scope.websiteId]);
  // Closing the panel before the autosave: keep what was typed.
  const latest = useRef(body);
  useEffect(() => {
    latest.current = body;
  }, [body]);
  useEffect(
    () => () => {
      if (latest.current.trim() !== draft.current.trim()) {
        void savePortalDraft(createClient(), customer.id, latest.current)
          .then(() =>
            queryClient.invalidateQueries({ queryKey: portalKeys.inbox(scope.websiteId) })
          )
          .catch(() => undefined);
      }
    },
    [customer.id, queryClient, scope.websiteId]
  );

  const lastOwn = data?.toReversed().find((m) => m.sender === 'owner');

  let lastDay = '';

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4'>
      {/* Keyboard open on a phone: room for the conversation and the reply. */}
      {!keyboard && <ProfileCard customerId={customer.id} />}
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
                {m.via === 'assistant' && (
                  <p className='mb-1 flex items-center gap-1 text-[11px] font-medium opacity-80'>
                    <Icons.sparkles className='size-3' aria-hidden />
                    {t('viaAssistant')}
                  </p>
                )}
                <p className='break-words'>{m.body}</p>
                <p className='mt-1 text-right text-[11px] opacity-70'>
                  {m.reply_to && `${t('validated')} · `}
                  {format.dateTime(new Date(m.created_at), { timeStyle: 'short' })}
                  {own && m === lastOwn && ` · ${m.read_at ? t('seen') : t('sent')}`}
                </p>
              </div>
              {m.via === 'assistant' && (
                <HandoffBrief
                  message={m}
                  disabled={customer.status !== 'active'}
                  onAnswer={(draft) => {
                    setReplyTo(m);
                    if (draft) form.setFieldValue('body', draft);
                  }}
                />
              )}
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
        {replyTo && (
          <div className='bg-muted flex items-start gap-2 rounded-md px-3 py-2 text-xs'>
            <Icons.sparkles className='mt-0.5 size-3.5 shrink-0' aria-hidden />
            <p className='line-clamp-2 min-w-0 flex-1'>
              {t('answering', { question: replyTo.body })}
            </p>
            <button
              type='button'
              className='text-muted-foreground hover:text-foreground'
              onClick={() => setReplyTo(null)}
              aria-label={t('answeringCancel')}
            >
              <Icons.close className='size-3.5' aria-hidden />
            </button>
          </div>
        )}
        <div className={cn('flex flex-wrap gap-1.5', keyboard && 'hidden')}>
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

/** What the assistant prepared for the team: summary, its answer, a reply to edit. */
function HandoffBrief({
  message,
  disabled,
  onAnswer
}: {
  message: PortalMessage;
  disabled: boolean;
  onAnswer: (draft: string | null) => void;
}) {
  const t = useTranslations('clientPortal.thread');
  const brief = message.brief ?? {};
  return (
    <div className='max-w-[85%] space-y-2 rounded-xl border border-dashed p-3 text-xs'>
      <div className='flex flex-wrap items-center gap-2'>
        <Badge variant={message.answered ? 'secondary' : 'default'}>
          {message.answered ? t('handoff.answered') : t('handoff.waiting')}
        </Badge>
        <span className='text-muted-foreground'>{t('handoff.private')}</span>
      </div>
      {brief.summary && (
        <p>
          <span className='font-medium'>{t('handoff.summary')} </span>
          {brief.summary}
        </p>
      )}
      {brief.answer && (
        <details>
          <summary className='cursor-pointer font-medium'>{t('handoff.aiAnswer')}</summary>
          <p className='text-muted-foreground mt-1 whitespace-pre-wrap'>{brief.answer}</p>
        </details>
      )}
      {brief.draft && (
        <div className='bg-muted/60 rounded-md p-2'>
          <p className='mb-1 font-medium'>{t('handoff.draft')}</p>
          <p className='whitespace-pre-wrap'>{brief.draft}</p>
        </div>
      )}
      {!message.answered && (
        <div className='flex flex-wrap gap-2'>
          {brief.draft && (
            <Button
              size='sm'
              className='h-7 text-xs'
              disabled={disabled}
              onClick={() => onAnswer(brief.draft ?? null)}
            >
              <Icons.edit aria-hidden />
              {t('handoff.useDraft')}
            </Button>
          )}
          <Button
            size='sm'
            variant='outline'
            className='h-7 text-xs'
            disabled={disabled}
            onClick={() => onAnswer(null)}
          >
            {t('handoff.answer')}
          </Button>
        </div>
      )}
    </div>
  );
}

'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { useErrorMessage } from '@/hooks/use-error-message';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { getCollection } from '@/features/site/config/collections';
import { siteKeys } from '@/features/site/api/queries';
import {
  createCollectionItem,
  getSeoSettings,
  saveSetting,
  updateCollectionItem
} from '@/features/site/api/service';
import { useSiteScope } from '@/features/site/components/use-site-scope';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import type { AssistantMessage, AssistantProposal, AssistantReply } from '../types';

const SUGGESTIONS = ['week', 'service', 'seo', 'team'] as const;

type Turn = AssistantMessage & { proposals?: AssistantProposal[] };

function ProposalCard({ proposal, canEdit }: { proposal: AssistantProposal; canEdit: boolean }) {
  const scope = useSiteScope();
  const queryClient = useQueryClient();
  const t = useTranslations('assistant');
  const errorMessage = useErrorMessage();
  const [applied, setApplied] = useState(false);
  const apply = useMutation({
    mutationFn: async () => {
      const db = createClient();
      if (proposal.kind === 'service') {
        await updateCollectionItem(db, getCollection('services')!, proposal.id, proposal.changes);
      } else if (proposal.kind === 'faq') {
        await createCollectionItem(db, getCollection('faq')!, scope, {
          question: proposal.question,
          answer: proposal.answer,
          status: 'published'
        });
      } else {
        const current = await getSeoSettings(db, scope.websiteId);
        await saveSetting(db, scope, 'seo', {
          ...current,
          ...(proposal.title ? { title: proposal.title } : {}),
          ...(proposal.description ? { description: proposal.description } : {})
        });
      }
    },
    onSuccess: () => {
      setApplied(true);
      toast.success(t('applied'));
      void queryClient.invalidateQueries({ queryKey: siteKeys.website(scope.websiteId) });
    },
    onError: (e) => toast.error(errorMessage(e, 'saveFailed'))
  });

  const title =
    proposal.kind === 'service'
      ? t('proposal.service', { name: proposal.name })
      : proposal.kind === 'faq'
        ? t('proposal.faq')
        : t('proposal.seo');
  const rows: [string, string | undefined][] =
    proposal.kind === 'service'
      ? [
          [t('proposal.description'), proposal.changes.description],
          [t('proposal.priceLabel'), proposal.changes.price_label]
        ]
      : proposal.kind === 'faq'
        ? [
            [t('proposal.question'), proposal.question],
            [t('proposal.answer'), proposal.answer]
          ]
        : [
            [t('proposal.title'), proposal.title],
            [t('proposal.description'), proposal.description]
          ];

  return (
    <Card className='mt-2 gap-3 py-4'>
      <CardHeader className='px-4'>
        <CardTitle className='flex items-center gap-2 text-sm'>
          <Icons.sparkles className='size-4' aria-hidden />
          {title}
          {applied && <Badge variant='secondary'>{t('appliedBadge')}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className='space-y-2 px-4 text-sm'>
        {rows
          .filter(([, v]) => v)
          .map(([label, value]) => (
            <div key={label}>
              <p className='text-muted-foreground text-xs'>{label}</p>
              <p className='whitespace-pre-wrap'>{value}</p>
            </div>
          ))}
      </CardContent>
      {canEdit && !applied && (
        <CardFooter className='px-4'>
          <Button size='sm' disabled={apply.isPending} onClick={() => apply.mutate()}>
            {apply.isPending ? t('applying') : t('apply')}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

export function AssistantChat() {
  const { canEdit, website } = useSiteScope();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [remaining, setRemaining] = useState<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const t = useTranslations('assistant');

  const ask = useMutation({
    mutationFn: async (history: Turn[]) => {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history.map(({ role, text }) => ({ role, text })) })
      });
      const body = (await res.json().catch(() => ({}))) as Partial<AssistantReply> & {
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? 'unavailable');
      return body as AssistantReply;
    },
    onSuccess: (data) => {
      setTurns((t) => [...t, { role: 'assistant', text: data.reply, proposals: data.proposals }]);
      if (typeof data.remaining === 'number') setRemaining(data.remaining);
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }));
    },
    onError: (e) => toast.error(e.message === 'limit' ? t('limit') : t('unavailable'))
  });

  function send(text: string) {
    const message = text.trim().slice(0, 4000);
    if (!message || ask.isPending) return;
    const history: Turn[] = [...turns, { role: 'user', text: message }];
    setTurns(history);
    setDraft('');
    ask.mutate(history);
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }));
  }

  return (
    <div className='mx-auto flex w-full max-w-3xl flex-col gap-4'>
      {turns.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2 text-base'>
              <Icons.sparkles className='size-5' aria-hidden />
              {t('title', { name: website.name })}
            </CardTitle>
          </CardHeader>
          <CardContent className='text-muted-foreground space-y-3 text-sm'>
            <p>{t('intro')}</p>
            <div className='flex flex-wrap gap-2'>
              {SUGGESTIONS.map((s) => (
                <Button
                  key={s}
                  variant='outline'
                  size='sm'
                  className='h-auto min-h-8 whitespace-normal text-left'
                  onClick={() => send(t(`suggestions.${s}`))}
                >
                  {t(`suggestions.${s}`)}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className='flex flex-col gap-3' aria-live='polite'>
        {turns.map((turn, i) => (
          <div
            key={i}
            className={cn('flex', turn.role === 'user' ? 'justify-end' : 'justify-start')}
          >
            <div
              className={cn(
                'max-w-[85%] rounded-2xl px-4 py-3 text-sm',
                turn.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'
              )}
            >
              <p className='whitespace-pre-wrap'>{turn.text}</p>
              {turn.proposals?.map((p, j) => (
                <ProposalCard key={j} proposal={p} canEdit={canEdit} />
              ))}
            </div>
          </div>
        ))}
        {ask.isPending && (
          <div className='text-muted-foreground flex items-center gap-2 text-sm'>
            <Icons.spinner className='size-4 animate-spin' aria-hidden />
            {t('thinking')}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        className='bg-background sticky bottom-4 flex items-end gap-2 rounded-2xl border p-2 shadow-sm'
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <Textarea
          aria-label={t('message')}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(draft);
            }
          }}
          placeholder={t('placeholder')}
          className='max-h-40 min-h-11 resize-none border-0 shadow-none focus-visible:ring-0'
          maxLength={4000}
        />
        <Button
          type='submit'
          size='icon'
          disabled={!draft.trim() || ask.isPending}
          aria-label={t('send')}
        >
          <Icons.send className='size-4' aria-hidden />
        </Button>
      </form>
      {remaining !== null && (
        <p className='text-muted-foreground text-center text-xs'>
          {t('remaining', { count: remaining })}
        </p>
      )}
    </div>
  );
}

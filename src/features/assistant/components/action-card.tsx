'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useErrorMessage } from '@/hooks/use-error-message';
import { getCollection } from '@/features/site/config/collections';
import { siteKeys } from '@/features/site/api/queries';
import {
  createCollectionItem,
  getSeoSettings,
  saveSetting,
  updateAppointment,
  updateCollectionItem,
  updateSubmission
} from '@/features/site/api/service';
import { useSiteScope } from '@/features/site/components/use-site-scope';
import { AppError } from '@/lib/errors';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import type { AssistantProposal } from '../types';

type State = 'waiting' | 'done' | 'declined';

const ICONS = {
  service: Icons.edit,
  faq: Icons.help,
  seo: Icons.trendingUp,
  request_status: Icons.inbox,
  appointment_status: Icons.calendar,
  announcement: Icons.speakerphone,
  support: Icons.send
} as const;

const rows = (pairs: [string, string | undefined][]) =>
  pairs.filter((r): r is [string, string] => Boolean(r[1]));

/** What an action changes, as label/value rows (no customer data ever). */
function useRows(p: AssistantProposal): { title: string; rows: [string, string][]; note?: string } {
  const t = useTranslations('assistant');
  const tReq = useTranslations('site.requests.status');
  const tApt = useTranslations('site.appointments.status');
  switch (p.kind) {
    case 'service':
      return {
        title: t('proposal.service', { name: p.name }),
        rows: rows([
          [t('proposal.description'), p.changes.description],
          [t('proposal.priceLabel'), p.changes.price_label]
        ])
      };
    case 'faq':
      return {
        title: t('proposal.faq'),
        rows: rows([
          [t('proposal.question'), p.question],
          [t('proposal.answer'), p.answer]
        ])
      };
    case 'seo':
      return {
        title: t('proposal.seo'),
        rows: rows([
          [t('proposal.title'), p.title],
          [t('proposal.description'), p.description]
        ])
      };
    case 'request_status':
      return {
        title: t('proposal.requestStatus'),
        rows: rows([
          [t('proposal.item'), p.label],
          [t('proposal.change'), `${tReq(p.from)} → ${tReq(p.to)}`]
        ])
      };
    case 'appointment_status':
      return {
        title: t('proposal.appointmentStatus'),
        rows: rows([
          [t('proposal.item'), p.label],
          [t('proposal.change'), `${tApt(p.from)} → ${tApt(p.to)}`]
        ]),
        note: t('proposal.customerMayBeNotified')
      };
    case 'announcement':
      return {
        title: t('proposal.announcement'),
        rows: rows([
          [t('proposal.title'), p.title],
          [t('proposal.content'), p.content]
        ]),
        note: t('proposal.savedAsDraft')
      };
    case 'support':
      return {
        title: t('proposal.support'),
        rows: rows([
          [t('proposal.subject'), p.subject],
          [t('proposal.details'), p.details]
        ]),
        note: t('proposal.supportNote')
      };
  }
}

/**
 * One action the assistant prepared. Nothing happens until the user taps
 * Authorize; Decline just dismisses it. Every write runs as the user (RLS).
 */
export function ActionCard({
  proposal,
  canEdit
}: {
  proposal: AssistantProposal;
  canEdit: boolean;
}) {
  const scope = useSiteScope();
  const queryClient = useQueryClient();
  const t = useTranslations('assistant');
  const tCat = useTranslations('assistant.categories');
  const tUrg = useTranslations('assistant.urgency');
  const errorMessage = useErrorMessage();
  const [state, setState] = useState<State>('waiting');
  const { title, rows, note } = useRows(proposal);
  const Icon = ICONS[proposal.kind];
  // A support ticket is open to every member; other actions need the editor role.
  const allowed = proposal.kind === 'support' || canEdit;

  const run = useMutation({
    mutationFn: async () => {
      const db = createClient();
      switch (proposal.kind) {
        case 'service':
          return updateCollectionItem(
            db,
            getCollection('services')!,
            proposal.id,
            proposal.changes
          );
        case 'faq':
          return createCollectionItem(db, getCollection('faq')!, scope, {
            question: proposal.question,
            answer: proposal.answer,
            status: 'published'
          });
        case 'seo': {
          const current = await getSeoSettings(db, scope.websiteId);
          return saveSetting(db, scope, 'seo', {
            ...current,
            ...(proposal.title ? { title: proposal.title } : {}),
            ...(proposal.description ? { description: proposal.description } : {})
          });
        }
        case 'request_status':
          return updateSubmission(db, proposal.id, { status: proposal.to });
        case 'appointment_status':
          return updateAppointment(db, proposal.id, { status: proposal.to });
        case 'announcement':
          return createCollectionItem(db, getCollection('announcements')!, scope, {
            title: proposal.title,
            content: proposal.content,
            status: 'draft'
          });
        case 'support': {
          const { error } = await db.rpc('support_ticket_create', {
            p_website_id: scope.websiteId,
            p_category: proposal.category,
            p_urgency: proposal.urgency,
            p_subject: proposal.subject,
            p_details: proposal.details
          });
          if (error) {
            throw new AppError(error.code === 'PT429' ? 'rateLimited' : 'saveFailed', {
              cause: error
            });
          }
        }
      }
    },
    onSuccess: () => {
      setState('done');
      toast.success(proposal.kind === 'support' ? t('ticketSent') : t('applied'));
      void queryClient.invalidateQueries({ queryKey: siteKeys.website(scope.websiteId) });
    },
    onError: (e) => toast.error(errorMessage(e, 'saveFailed'))
  });

  return (
    <div
      className={cn(
        'bg-background mt-3 rounded-xl border p-3 text-sm shadow-xs',
        state === 'declined' && 'opacity-60'
      )}
    >
      <div className='flex items-start gap-2'>
        <span className='bg-primary/10 text-primary mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg'>
          <Icon className='size-4' aria-hidden />
        </span>
        <div className='min-w-0 flex-1'>
          <div className='flex flex-wrap items-center gap-1.5'>
            <p className='font-medium'>{title}</p>
            {state === 'done' && (
              <Badge variant='secondary'>
                {proposal.kind === 'support' ? t('sentBadge') : t('appliedBadge')}
              </Badge>
            )}
            {state === 'declined' && <Badge variant='outline'>{t('declinedBadge')}</Badge>}
          </div>
          {proposal.kind === 'support' && (
            <div className='mt-1 flex flex-wrap gap-1.5'>
              <Badge variant='outline'>{tCat(proposal.category)}</Badge>
              <Badge
                variant={
                  proposal.urgency === 'urgent' || proposal.urgency === 'high'
                    ? 'destructive'
                    : 'outline'
                }
              >
                {tUrg(proposal.urgency)}
              </Badge>
            </div>
          )}
        </div>
      </div>
      <dl className='mt-2 space-y-2'>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className='text-muted-foreground text-xs'>{label}</dt>
            <dd className='break-words whitespace-pre-wrap'>{value}</dd>
          </div>
        ))}
      </dl>
      {note && <p className='text-muted-foreground mt-2 text-xs'>{note}</p>}
      {state === 'waiting' &&
        (allowed ? (
          <div className='mt-3 grid grid-cols-2 gap-2 sm:flex sm:justify-end'>
            <Button
              variant='outline'
              className='h-11 sm:h-9'
              disabled={run.isPending}
              onClick={() => setState('declined')}
            >
              {t('decline')}
            </Button>
            <Button className='h-11 sm:h-9' disabled={run.isPending} onClick={() => run.mutate()}>
              {run.isPending ? (
                <Icons.spinner className='size-4 animate-spin' aria-hidden />
              ) : (
                <Icons.check className='size-4' aria-hidden />
              )}
              {proposal.kind === 'support' ? t('authorizeSend') : t('authorize')}
            </Button>
          </div>
        ) : (
          <p className='text-muted-foreground mt-3 text-xs'>{t('editorsOnly')}</p>
        ))}
    </div>
  );
}

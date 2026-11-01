'use client';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useQueryStates } from 'nuqs';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Icons } from '@/components/icons';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatTile } from '@/features/insights/components/stat-tile';
import { useSiteScope } from '@/features/site/components/use-site-scope';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { campaignsQueryOptions, emailKeys, emailOverviewQueryOptions } from '../api/queries';
import { processCampaign } from '../api/service';
import { emailParams, type EmailTab } from '../lib/filters';
import { CampaignEditor } from './campaign-editor';
import { CampaignsList } from './campaigns-list';
import { ContactsPanel } from './contacts-panel';
import { EmailConfigProvider, type EmailPageConfig } from './email-context';
import { SenderDialog } from './sender-dialog';

/**
 * Email campaigns of the active website: campaigns, the editor and the
 * contacts. Everything is read and written through the email_* database
 * functions as the signed-in user; sending goes through the dashboard routes.
 */
export function EmailCampaignsView(config: EmailPageConfig) {
  const scope = useSiteScope();
  const [isPending, startTransition] = useTransition();
  const [params, setParams] = useQueryStates(emailParams, {
    startTransition,
    shallow: true,
    history: 'replace'
  });
  const db = createClient();
  const { data: overview } = useSuspenseQuery(emailOverviewQueryOptions(db, scope.websiteId));
  const { data: campaigns } = useSuspenseQuery(campaignsQueryOptions(db, scope.websiteId));
  const t = useTranslations('emailCampaigns');
  const format = useFormatter();
  const [senderOpen, setSenderOpen] = useState(false);
  useSendingLoop(
    campaigns.filter((c) => c.status === 'sending').map((c) => c.id),
    overview.can_send && config.providerReady && !overview.paused
  );

  const openCampaign = (id: string | null) => setParams({ tab: 'editor', campaign: id ?? '' });
  const quota = overview.quota;

  return (
    <EmailConfigProvider value={config}>
      <div
        className={cn('space-y-6 transition-opacity', isPending && 'opacity-70')}
        aria-busy={isPending}
      >
        {!config.providerReady && (
          <Alert>
            <Icons.info className='size-4' aria-hidden />
            <AlertTitle>{t('alerts.notConfiguredTitle')}</AlertTitle>
            <AlertDescription>{t('alerts.notConfigured')}</AlertDescription>
          </Alert>
        )}
        {overview.paused && (
          <Alert variant='destructive'>
            <Icons.alertCircle className='size-4' aria-hidden />
            <AlertTitle>{t('alerts.pausedTitle')}</AlertTitle>
            <AlertDescription>{t(`alerts.paused.${overview.paused.reason}`)}</AlertDescription>
          </Alert>
        )}
        {overview.missing.length > 0 && (
          <Alert>
            <Icons.alertCircle className='size-4' aria-hidden />
            <AlertTitle>{t('alerts.senderTitle')}</AlertTitle>
            <AlertDescription>
              <p>{overview.can_send ? t('alerts.sender') : t('alerts.senderAskAdmin')}</p>
              {overview.can_send && (
                <Button size='sm' className='mt-2' onClick={() => setSenderOpen(true)}>
                  {t('sender.open')}
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}

        <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
          <StatTile
            icon='teams'
            label={t('stats.subscribed')}
            value={format.number(overview.contacts.subscribed)}
            hint={t('stats.contactsTotal', { count: overview.contacts.total })}
          />
          <StatTile
            icon='mail'
            label={t('stats.month')}
            value={
              quota.limit === null
                ? format.number(quota.used)
                : t('stats.ofLimit', {
                    used: format.number(quota.used),
                    limit: format.number(quota.limit)
                  })
            }
            hint={quota.limit === null ? t('stats.unlimited') : t('stats.monthHint')}
          />
          <StatTile
            icon='send'
            label={t('stats.campaignsSent')}
            value={format.number(campaigns.filter((c) => c.status === 'sent').length)}
            hint={t('stats.drafts', {
              count: campaigns.filter((c) => c.status === 'draft').length
            })}
          />
          <StatTile
            icon='alertCircle'
            label={t('stats.unreachable')}
            value={format.number(
              overview.contacts.unsubscribed +
                overview.contacts.bounced +
                overview.contacts.complained
            )}
            hint={t('stats.unreachableHint')}
          />
        </div>

        <Tabs value={params.tab} onValueChange={(v) => setParams({ tab: v as EmailTab })}>
          <div className='flex flex-wrap items-center justify-between gap-3'>
            <TabsList>
              <TabsTrigger value='campaigns'>{t('tabs.campaigns')}</TabsTrigger>
              <TabsTrigger value='editor'>
                {params.campaign ? t('tabs.edit') : t('tabs.create')}
              </TabsTrigger>
              <TabsTrigger value='contacts'>{t('tabs.contacts')}</TabsTrigger>
            </TabsList>
            <div className='flex gap-2'>
              {overview.can_send && (
                <Button variant='outline' size='sm' onClick={() => setSenderOpen(true)}>
                  <Icons.settings className='size-4' aria-hidden />
                  {t('sender.open')}
                </Button>
              )}
              {overview.can_edit && (
                <Button size='sm' onClick={() => openCampaign(null)}>
                  <Icons.add className='size-4' aria-hidden />
                  {t('newCampaign')}
                </Button>
              )}
            </div>
          </div>
          <TabsContent value='campaigns' className='mt-4'>
            <CampaignsList campaigns={campaigns} overview={overview} onOpen={openCampaign} />
          </TabsContent>
          <TabsContent value='editor' className='mt-4'>
            <CampaignEditor
              key={params.campaign || 'new'}
              campaign={campaigns.find((c) => c.id === params.campaign) ?? null}
              overview={overview}
              onSaved={(id) => setParams({ campaign: id })}
              onSent={() => setParams({ tab: 'campaigns', campaign: '' })}
              onOpenSender={() => setSenderOpen(true)}
            />
          </TabsContent>
          <TabsContent value='contacts' className='mt-4'>
            <ContactsPanel overview={overview} />
          </TabsContent>
        </Tabs>
        {overview.can_send && (
          <SenderDialog open={senderOpen} onOpenChange={setSenderOpen} overview={overview} />
        )}
      </div>
    </EmailConfigProvider>
  );
}

/**
 * While a campaign is being sent and the page is open, an owner / admin keeps
 * sending the next batches (the worker does the same in the background).
 * Everyone else just refreshes the numbers.
 */
function useSendingLoop(sendingIds: string[], canSend: boolean) {
  const scope = useSiteScope();
  const queryClient = useQueryClient();
  const busy = useRef(false);
  const key = sendingIds.join(',');
  useEffect(() => {
    if (!key) return;
    const ids = key.split(',');
    const tick = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        if (canSend) {
          for (const id of ids) await processCampaign(id).catch(() => undefined);
        }
      } finally {
        busy.current = false;
        await queryClient.invalidateQueries({ queryKey: emailKeys.all(scope.websiteId) });
      }
    };
    const timer = setInterval(tick, canSend ? 8000 : 15000);
    return () => clearInterval(timer);
  }, [key, canSend, queryClient, scope.websiteId]);
}

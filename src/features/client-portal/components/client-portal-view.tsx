'use client';

import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useErrorMessage } from '@/hooks/use-error-message';
import { createClient } from '@/lib/supabase/client';
import { formatMoney } from '@/features/payments/lib/money';
import { useSiteScope } from '@/features/site/components/use-site-scope';
import { portalKeys, portalOverviewQueryOptions } from '../api/queries';
import { archivePortalItem, portalDocumentUrl, setPortalCustomerStatus } from '../api/service';
import type { PortalCustomer, PortalItem, PortalOverview } from '../api/types';
import { InviteDialog } from './invite-dialog';
import { PublishSheet } from './publish-sheet';
import { PortalSettingsPanel } from './portal-settings';
import { ThreadSheet } from './thread-sheet';
import { TrialDialog } from './trial-dialog';

/**
 * Client portal of the active website: customers (paid or invited) with their
 * payments and offer, what was published to them, and their messages. Every
 * action goes through portal_admin_* (editor+, audited); e-mails are sent by
 * the client website itself.
 */
export function ClientPortalView() {
  const scope = useSiteScope();
  const t = useTranslations('clientPortal');
  const { data } = useSuspenseQuery(portalOverviewQueryOptions(createClient(), scope.websiteId));
  const [inviteOpen, setInviteOpen] = useState(false);
  const [publishFor, setPublishFor] = useState<{ customerId?: string } | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [trialFor, setTrialFor] = useState<{
    customer: PortalCustomer;
    mode: 'trial' | 'membership';
  } | null>(null);
  const unread = data.customers.reduce((sum, c) => sum + c.unread, 0);
  const active = data.customers.filter((c) => c.status === 'active').length;
  const thread = data.customers.find((c) => c.id === threadId) ?? null;

  return (
    <div className='space-y-4'>
      <div className='grid gap-3 sm:grid-cols-3'>
        <Stat label={t('stats.customers')} value={active} icon='teams' />
        <Stat label={t('stats.unread')} value={unread} icon='chat' highlight={unread > 0} />
        <Stat
          label={t('stats.emails')}
          value={data.outbox.pending}
          icon='mail'
          hint={
            data.outbox.failed > 0 ? t('stats.failed', { count: data.outbox.failed }) : undefined
          }
        />
      </div>

      <div className='flex flex-wrap gap-2'>
        <Button onClick={() => setPublishFor({})}>
          <Icons.send aria-hidden />
          {t('actions.publish')}
        </Button>
        <Button variant='outline' onClick={() => setInviteOpen(true)}>
          <Icons.mail aria-hidden />
          {t('actions.invite')}
        </Button>
      </div>

      <Tabs defaultValue='customers'>
        <TabsList>
          <TabsTrigger value='customers'>
            {t('tabs.customers')}
            {unread > 0 && <Badge className='ml-1.5'>{unread}</Badge>}
          </TabsTrigger>
          <TabsTrigger value='published'>{t('tabs.published')}</TabsTrigger>
          <TabsTrigger value='plans'>{t('tabs.plans')}</TabsTrigger>
        </TabsList>
        <TabsContent value='customers' className='mt-3'>
          <CustomerList
            data={data}
            onThread={setThreadId}
            onPublish={(customerId) => setPublishFor({ customerId })}
            onTrial={(customer, mode) => setTrialFor({ customer, mode })}
          />
        </TabsContent>
        <TabsContent value='published' className='mt-3'>
          <PublishedList data={data} />
        </TabsContent>
        <TabsContent value='plans' className='mt-3'>
          <PortalSettingsPanel />
        </TabsContent>
      </Tabs>

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} offers={data.offers} />
      <PublishSheet
        open={publishFor !== null}
        initialCustomerId={publishFor?.customerId}
        onOpenChange={(open) => !open && setPublishFor(null)}
        data={data}
      />
      <ThreadSheet customer={thread} onOpenChange={(open) => !open && setThreadId(null)} />
      <TrialDialog
        customer={trialFor?.customer ?? null}
        mode={trialFor?.mode ?? 'trial'}
        onOpenChange={(open) => !open && setTrialFor(null)}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
  hint,
  highlight
}: {
  label: string;
  value: number;
  icon: keyof typeof Icons;
  hint?: string;
  highlight?: boolean;
}) {
  const Icon = Icons[icon];
  return (
    <Card className='py-4'>
      <CardContent className='flex items-center gap-3 px-4'>
        <span
          className={`flex size-9 items-center justify-center rounded-lg ${highlight ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
        >
          <Icon className='size-4' aria-hidden />
        </span>
        <div className='min-w-0'>
          <p className='text-muted-foreground text-xs'>{label}</p>
          <p className='text-xl font-semibold tabular-nums'>{value}</p>
          {hint && <p className='text-destructive text-xs'>{hint}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function offerLabel(data: PortalOverview, id: string) {
  return data.offers.find((o) => o.id === id)?.name ?? id;
}

/** What a member can read now: plan, payment due, free offer, or nothing more. */
function AccessBadge({ customer }: { customer: PortalCustomer }) {
  const t = useTranslations('clientPortal.access');
  const format = useFormatter();
  const sub = customer.subscription;
  const [now] = useState(() => Date.now());
  if (sub?.status === 'past_due')
    return <Badge variant='destructive'>{t('pastDue', { plan: sub.plan_name })}</Badge>;
  if (sub?.status === 'active') {
    return (
      <Badge variant='secondary'>
        <Icons.star aria-hidden />
        {sub.cancel_at_period_end && sub.current_period_end
          ? t('planEnds', {
              plan: sub.plan_name,
              date: format.dateTime(new Date(sub.current_period_end), { dateStyle: 'medium' })
            })
          : t('plan', { plan: sub.plan_name })}
      </Badge>
    );
  }
  if (customer.trial_ends_at && new Date(customer.trial_ends_at).getTime() > now) {
    return (
      <Badge variant='outline'>
        <Icons.clock aria-hidden />
        {t('trial', {
          date: format.dateTime(new Date(customer.trial_ends_at), { dateStyle: 'medium' })
        })}
      </Badge>
    );
  }
  return <Badge variant='outline'>{t('none')}</Badge>;
}

function CustomerList({
  data,
  onThread,
  onPublish,
  onTrial
}: {
  data: PortalOverview;
  onThread: (id: string) => void;
  onPublish: (id: string) => void;
  onTrial: (customer: PortalCustomer, mode: 'trial' | 'membership') => void;
}) {
  const t = useTranslations('clientPortal');
  const format = useFormatter();
  const [confirm, setConfirm] = useState<PortalCustomer | null>(null);
  const scope = useSiteScope();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const status = useMutation({
    mutationFn: (c: PortalCustomer) =>
      setPortalCustomerStatus(createClient(), c.id, c.status === 'active' ? 'revoked' : 'active'),
    onSuccess: () => {
      toast.success(t('customers.statusSaved'));
      void queryClient.invalidateQueries({ queryKey: portalKeys.all(scope.websiteId) });
    },
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: () => setConfirm(null)
  });

  if (data.customers.length === 0) {
    return (
      <Empty className='border'>
        <EmptyHeader>
          <EmptyMedia variant='icon'>
            <Icons.teams />
          </EmptyMedia>
          <EmptyTitle>{t('customers.emptyTitle')}</EmptyTitle>
          <EmptyDescription>{t('customers.emptyDescription')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <>
      <ul className='grid gap-3 lg:grid-cols-2'>
        {data.customers.map((c) => {
          const paid = c.payments.filter((p) => p.status === 'paid');
          return (
            <li key={c.id}>
              <Card className='h-full gap-3 py-4'>
                <CardHeader className='px-4'>
                  <div className='flex items-start justify-between gap-2'>
                    <div className='min-w-0'>
                      <CardTitle className='truncate text-base'>{c.name || c.email}</CardTitle>
                      <CardDescription className='truncate'>{c.email}</CardDescription>
                    </div>
                    <div className='flex shrink-0 gap-1'>
                      {c.unread > 0 && <Badge>{t('customers.unread', { count: c.unread })}</Badge>}
                      <Badge variant={c.status === 'active' ? 'secondary' : 'outline'}>
                        {t(`customers.status.${c.status}`)}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className='space-y-3 px-4 text-sm'>
                  <div className='flex flex-wrap gap-1'>
                    <AccessBadge customer={c} />
                    <Badge variant='outline'>{t(`customers.source.${c.source}`)}</Badge>
                    {c.offers.map((o) => (
                      <Badge key={o} variant='outline'>
                        {offerLabel(data, o)}
                      </Badge>
                    ))}
                  </div>
                  {paid.length > 0 ? (
                    <ul className='text-muted-foreground space-y-0.5 text-xs'>
                      {c.payments.map((p) => (
                        <li key={p.id} className='flex justify-between gap-2'>
                          <span className='truncate'>{p.offer_name ?? p.offer_id}</span>
                          <span className='tabular-nums'>
                            {formatMoney(p.amount, p.currency)} ·{' '}
                            {t(`customers.payment.${p.status}`)}
                            {p.paid_at &&
                              ` · ${format.dateTime(new Date(p.paid_at), { dateStyle: 'medium' })}`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className='text-muted-foreground text-xs'>{t('customers.noPayment')}</p>
                  )}
                  <p className='text-muted-foreground text-xs'>
                    {c.last_sign_in_at
                      ? t('customers.lastSignIn', {
                          date: format.dateTime(new Date(c.last_sign_in_at), {
                            dateStyle: 'medium',
                            timeStyle: 'short'
                          })
                        })
                      : t('customers.neverSignedIn')}
                  </p>
                  <div className='flex flex-wrap gap-2'>
                    <Button size='sm' variant='outline' onClick={() => onThread(c.id)}>
                      <Icons.chat aria-hidden />
                      {t('customers.messages')}
                    </Button>
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={() => onPublish(c.id)}
                      disabled={c.status !== 'active'}
                    >
                      <Icons.send aria-hidden />
                      {t('customers.publish')}
                    </Button>
                    {c.membership?.monthly && (
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={() => onTrial(c, 'membership')}
                        disabled={c.status !== 'active'}
                      >
                        <Icons.calendar aria-hidden />
                        {t('customers.membership')}
                      </Button>
                    )}
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={() => onTrial(c, 'trial')}
                      disabled={c.status !== 'active'}
                    >
                      <Icons.clock aria-hidden />
                      {t('customers.trial')}
                    </Button>
                    <Button size='sm' variant='ghost' onClick={() => setConfirm(c)}>
                      {c.status === 'active' ? t('customers.revoke') : t('customers.restore')}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
      <AlertDialog open={!!confirm} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.status === 'active'
                ? t('customers.revokeTitle')
                : t('customers.restoreTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.status === 'active'
                ? t('customers.revokeDescription', { email: confirm?.email ?? '' })
                : t('customers.restoreDescription', { email: confirm?.email ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={status.isPending}
              variant={confirm?.status === 'active' ? 'destructive' : 'default'}
              onClick={() => confirm && status.mutate(confirm)}
            >
              {confirm?.status === 'active' ? t('customers.revoke') : t('customers.restore')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function audienceLabel(
  t: ReturnType<typeof useTranslations<'clientPortal'>>,
  data: PortalOverview,
  item: PortalItem
) {
  if (item.audience === 'all') return t('audience.all');
  if (item.audience === 'offer')
    return t('audience.offerNamed', { offer: offerLabel(data, item.offer_id ?? '') });
  const c = data.customers.find((x) => x.id === item.customer_id);
  return t('audience.customerNamed', { name: c?.name || c?.email || '—' });
}

function PublishedList({ data }: { data: PortalOverview }) {
  const t = useTranslations('clientPortal');
  const format = useFormatter();
  const scope = useSiteScope();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const archive = useMutation({
    mutationFn: (id: string) => archivePortalItem(createClient(), id),
    onSuccess: () => {
      toast.success(t('published.archived'));
      void queryClient.invalidateQueries({ queryKey: portalKeys.all(scope.websiteId) });
    },
    onError: (error) => toast.error(errorMessage(error))
  });
  const open = async (path: string) => {
    try {
      window.open(await portalDocumentUrl(createClient(), path), '_blank', 'noopener,noreferrer');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
  const items = data.items.filter((i) => i.status === 'published');

  if (items.length === 0) {
    return (
      <Empty className='border'>
        <EmptyHeader>
          <EmptyMedia variant='icon'>
            <Icons.send />
          </EmptyMedia>
          <EmptyTitle>{t('published.emptyTitle')}</EmptyTitle>
          <EmptyDescription>{t('published.emptyDescription')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <ul className='space-y-2'>
      {items.map((item) => (
        <li key={item.id}>
          <Card className='gap-2 py-3'>
            <CardContent className='flex flex-col gap-2 px-4 sm:flex-row sm:items-center'>
              <div className='min-w-0 flex-1'>
                <div className='flex flex-wrap items-center gap-1.5'>
                  <Badge variant='secondary'>{t(`kinds.${item.kind}`)}</Badge>
                  {item.min_level > 0 && (
                    <Badge variant='outline'>
                      <Icons.lock aria-hidden />
                      {t('published.level', { level: item.min_level })}
                    </Badge>
                  )}
                  <span className='truncate font-medium'>{item.title}</span>
                </div>
                <p className='text-muted-foreground mt-1 text-xs'>
                  {audienceLabel(t, data, item)} ·{' '}
                  {format.dateTime(new Date(item.published_at), { dateStyle: 'medium' })} ·{' '}
                  {t('published.reads', { count: item.reads })}
                </p>
              </div>
              <div className='flex gap-2'>
                {item.document_path && (
                  <Button size='sm' variant='outline' onClick={() => open(item.document_path!)}>
                    <Icons.externalLink aria-hidden />
                    {t('published.open')}
                  </Button>
                )}
                <Button
                  size='sm'
                  variant='ghost'
                  disabled={archive.isPending}
                  onClick={() => archive.mutate(item.id)}
                >
                  <Icons.archive aria-hidden />
                  {t('published.archive')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}

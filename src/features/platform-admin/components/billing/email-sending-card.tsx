'use client';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { useErrorMessage } from '@/hooks/use-error-message';
import { createClient } from '@/lib/supabase/client';
import {
  adminEmailKeys,
  createEmailWorkerKey,
  emailSendingStatusQueryOptions,
  resumeEmailSending
} from '../../api/email';
import { ConfirmDialog } from './confirm-dialog';

/**
 * Staff: client e-mail campaigns. Whether sending works on the server (never the
 * keys), the e-mail worker key (shown once), delivery tracking, and websites
 * paused for too many bounces or complaints, with a Resume button.
 */
export function EmailSendingCard({
  providerReady,
  workerReady
}: {
  providerReady: boolean;
  workerReady: boolean;
}) {
  const { data } = useSuspenseQuery(emailSendingStatusQueryOptions(createClient()));
  const t = useTranslations('admin.emailSending');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const day = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium' });
  const refresh = () => queryClient.invalidateQueries({ queryKey: adminEmailKeys.status });
  const generate = useMutation({
    mutationFn: () => createEmailWorkerKey(createClient()),
    onSuccess: async (key) => {
      setNewKey(key);
      await refresh();
    },
    onError: (e) => toast.error(errorMessage(e, 'saveFailed'))
  });
  const resume = useMutation({
    mutationFn: (websiteId: string) => resumeEmailSending(createClient(), websiteId),
    onSuccess: async () => {
      toast.success(t('resumed'));
      await refresh();
    },
    onError: (e) => toast.error(errorMessage(e, 'saveFailed'))
  });

  return (
    <Card>
      <CardHeader className='gap-3 sm:flex sm:flex-row sm:items-start sm:justify-between'>
        <div className='space-y-1.5'>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </div>
        <div className='flex flex-wrap gap-2'>
          <Badge variant={providerReady ? 'default' : 'outline'}>
            {providerReady ? t('sendingOn') : t('sendingOff')}
          </Badge>
          <Badge variant={workerReady ? 'default' : 'outline'}>
            {workerReady ? t('workerOn') : t('workerOff')}
          </Badge>
          <Badge variant={data.last_event_at ? 'default' : 'outline'}>
            {data.last_event_at
              ? t('trackingOn', { date: day(data.last_event_at) })
              : t('trackingOff')}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className='space-y-4 text-sm'>
        <div className='flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center'>
          <div className='bg-muted flex size-9 shrink-0 items-center justify-center rounded-full'>
            <Icons.key className='text-muted-foreground size-4' aria-hidden />
          </div>
          <div className='min-w-0 flex-1'>
            <p className='font-medium'>{t('keyTitle')}</p>
            <p className='text-muted-foreground text-xs'>
              {data.key.active && data.key.key_hint && data.key.created_at
                ? `${t('keyActive', { hint: data.key.key_hint, date: day(data.key.created_at) })}${
                    data.key.last_used_at
                      ? ` ${t('keyUsed', { date: day(data.key.last_used_at) })}`
                      : ''
                  }`
                : t('keyNone')}
            </p>
            <p className='text-muted-foreground text-xs'>{t('keyHint')}</p>
          </div>
          <Button
            size='sm'
            variant={data.key.active ? 'outline' : 'default'}
            disabled={generate.isPending}
            onClick={() => (data.key.active ? setConfirming(true) : generate.mutate())}
          >
            {data.key.active ? t('regenerate') : t('generate')}
          </Button>
        </div>
        <div className='space-y-2'>
          <p className='font-medium'>{t('pausedTitle')}</p>
          {data.paused.length === 0 ? (
            <p className='text-muted-foreground text-xs'>{t('pausedNone')}</p>
          ) : (
            <ul className='divide-y rounded-lg border'>
              {data.paused.map((p) => (
                <li
                  key={p.website_id}
                  className='flex flex-wrap items-center justify-between gap-3 p-3'
                >
                  <div className='min-w-0'>
                    <p className='font-medium'>
                      {p.organization_name} · {p.website_name}
                    </p>
                    <p className='text-muted-foreground text-xs'>
                      {t(`reason.${p.reason}`)} · {day(p.paused_at)}
                      {p.detail?.sent
                        ? ` · ${t('rates', { sent: p.detail.sent, bounced: p.detail.bounced ?? 0, complained: p.detail.complained ?? 0 })}`
                        : ''}
                    </p>
                  </div>
                  <Button
                    size='sm'
                    variant='outline'
                    disabled={resume.isPending}
                    onClick={() => resume.mutate(p.website_id)}
                  >
                    {t('resume')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
      <ConfirmDialog
        open={confirming}
        destructive
        title={t('regenerate')}
        description={t('generateConfirm')}
        confirmLabel={t('regenerate')}
        onConfirm={() => generate.mutate()}
        onOpenChange={setConfirming}
      />
      <Dialog open={!!newKey} onOpenChange={(v) => !v && setNewKey(null)}>
        <DialogContent className='sm:max-w-lg'>
          <DialogHeader>
            <DialogTitle>{t('keyTitleNew')}</DialogTitle>
            <DialogDescription>{t('keyShownOnce')}</DialogDescription>
          </DialogHeader>
          <code className='bg-muted block rounded-md p-3 font-mono text-xs break-all select-all'>
            {newKey}
          </code>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() =>
                newKey &&
                navigator.clipboard
                  .writeText(newKey)
                  .then(() => toast.success(t('copied')))
                  .catch(() => undefined)
              }
            >
              <Icons.copy className='size-4' aria-hidden />
              {t('copy')}
            </Button>
            <Button onClick={() => setNewKey(null)}>{t('done')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

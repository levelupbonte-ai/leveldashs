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
import { createWebhookKey } from '../../api/billing';
import { adminInsightKeys, webhookKeyQueryOptions } from '../../api/queries';
import { ConfirmDialog } from './confirm-dialog';

/**
 * Staff: whether online payment is on (server environment, never the keys) and
 * the billing webhook key the Stripe webhook uses to record payments. The key is
 * shown once, right after it is generated.
 */
export function OnlinePaymentsCard({ enabled }: { enabled: boolean }) {
  const { data: key } = useSuspenseQuery(webhookKeyQueryOptions(createClient()));
  const t = useTranslations('admin.billing.online');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const generate = useMutation({
    mutationFn: () => createWebhookKey(createClient()),
    onSuccess: async (value) => {
      setNewKey(value);
      await queryClient.invalidateQueries({ queryKey: adminInsightKeys.webhookKey() });
    },
    onError: (e) => toast.error(errorMessage(e, 'saveFailed'))
  });
  const day = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium' });

  return (
    <Card>
      <CardHeader className='gap-3 sm:flex sm:flex-row sm:items-start sm:justify-between'>
        <div className='space-y-1.5'>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </div>
        <Badge variant={enabled ? 'default' : 'outline'} className='w-fit'>
          {enabled ? t('on') : t('off')}
        </Badge>
      </CardHeader>
      <CardContent className='space-y-4 text-sm'>
        <p className='text-muted-foreground'>{enabled ? t('onHint') : t('offHint')}</p>
        <div className='flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center'>
          <div className='bg-muted flex size-9 shrink-0 items-center justify-center rounded-full'>
            <Icons.key className='text-muted-foreground size-4' aria-hidden />
          </div>
          <div className='min-w-0 flex-1'>
            <p className='font-medium'>{t('keyTitle')}</p>
            <p className='text-muted-foreground text-xs'>
              {key.active && key.key_hint && key.created_at
                ? `${t('keyActive', { hint: key.key_hint, date: day(key.created_at) })}${
                    key.last_used_at ? ` ${t('keyUsed', { date: day(key.last_used_at) })}` : ''
                  }`
                : t('keyNone')}
            </p>
            <p className='text-muted-foreground text-xs'>{t('keyHint')}</p>
          </div>
          <Button
            size='sm'
            variant={key.active ? 'outline' : 'default'}
            disabled={generate.isPending}
            onClick={() => (key.active ? setConfirming(true) : generate.mutate())}
          >
            {key.active ? t('regenerate') : t('generate')}
          </Button>
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

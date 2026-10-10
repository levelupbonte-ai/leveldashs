'use client';

import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useErrorMessage } from '@/hooks/use-error-message';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { createClient } from '@/lib/supabase/client';
import { decideAccessRequest, type AccessRequest } from '../api/clients';
import { accessRequestsQueryOptions, adminInsightKeys } from '../api/queries';

const STATUS_VARIANT: Record<AccessRequest['status'], 'default' | 'secondary' | 'outline'> = {
  pending: 'default',
  approved: 'secondary',
  rejected: 'outline'
};

/** LevelUp staff: who asked for dashboard access, approve (creates their organization) or reject. */
export function AccessRequests() {
  const queryClient = useQueryClient();
  const t = useTranslations('admin.accessRequests');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const { data } = useSuspenseQuery(accessRequestsQueryOptions(createClient()));
  const decide = useMutation({
    mutationFn: decideAccessRequest,
    onSuccess: (_, vars) => {
      toast.success(vars.approve ? t('approved') : t('rejected'));
      void queryClient.invalidateQueries({ queryKey: adminInsightKeys.accessRequests() });
      void queryClient.invalidateQueries({ queryKey: adminInsightKeys.allWebsites() });
    },
    onError: (e) => toast.error(errorMessage(e))
  });
  const pending = data.filter((r) => r.status === 'pending').length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          {t('title')} {pending > 0 && <Badge>{pending}</Badge>}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-3'>
        {data.length === 0 && <p className='text-muted-foreground text-sm'>{t('empty')}</p>}
        {data.map((r) => (
          <div
            key={r.user_id}
            className='flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-start sm:justify-between'
          >
            <div className='min-w-0 space-y-1 text-sm'>
              <p className='font-medium'>
                {r.business_name}{' '}
                <Badge variant={STATUS_VARIANT[r.status]} className='ml-1 align-middle'>
                  {t(`status.${r.status}`)}
                </Badge>
              </p>
              <p className='text-muted-foreground'>
                {r.full_name ? `${r.full_name} · ` : ''}
                {r.email}
                {r.phone ? ` · ${r.phone}` : ''}
              </p>
              {r.website && <p className='text-muted-foreground truncate'>{r.website}</p>}
              {r.message && (
                <p className='text-muted-foreground whitespace-pre-wrap'>{r.message}</p>
              )}
              <p className='text-muted-foreground text-xs'>
                {format.dateTime(new Date(r.created_at), {
                  dateStyle: 'medium',
                  timeStyle: 'short'
                })}
              </p>
            </div>
            {r.status === 'pending' && (
              <div className='flex shrink-0 gap-2'>
                <Button
                  size='sm'
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ userId: r.user_id, approve: true })}
                >
                  {t('approve')}
                </Button>
                <Button
                  size='sm'
                  variant='outline'
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ userId: r.user_id, approve: false })}
                >
                  {t('reject')}
                </Button>
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

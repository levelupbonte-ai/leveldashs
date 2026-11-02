'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { LoadingButton } from '@/components/ui/loading-button';
import { useErrorMessage } from '@/hooks/use-error-message';
import { useAppForm } from '@/lib/form';
import { cn } from '@/lib/utils';
import { billingKeys } from '../api/queries';
import { requestPlanUpgrade } from '../api/service';
import { LIMIT_KEYS, type BillingSummary, type PlanSummary } from '../api/types';
import { formatMoney, storageParts } from '../lib/format';
import { taglineFor } from './plan-card';

/** Plan cards with limits and features. "Upgrade" asks LevelUp; it is not a payment. */
export function PlanComparison({
  summary,
  organizationId
}: {
  summary: BillingSummary;
  organizationId: string;
}) {
  const t = useTranslations('billing');
  const format = useFormatter();
  const [asking, setAsking] = useState<PlanSummary | null>(null);
  const currentIndex = summary.plans.findIndex((p) => p.key === summary.plan.key);

  const limitValue = (key: (typeof LIMIT_KEYS)[number], v: number | null | undefined) => {
    if (v === null || v === undefined) return t('limits.unlimited');
    if (key === 'media_mb') {
      const s = storageParts(v * 1048576);
      return `${format.number(s.value)} ${s.unit}`;
    }
    return format.number(v);
  };

  const priceLine = (p: PlanSummary) => {
    if (!p.price_state) return null;
    if (p.price_state === 'free') return t('plan.free');
    if (p.price_state === 'unset' || p.price === null || !p.currency) return t('plan.priceUnset');
    return t('plan.perMonth', {
      price: formatMoney(format.number, p.price, p.currency)
    });
  };

  return (
    <section id='plans' className='scroll-mt-20 space-y-4' aria-labelledby='plans-title'>
      <div>
        <h2 id='plans-title' className='text-lg font-semibold'>
          {t('plans.title')}
        </h2>
        <p className='text-muted-foreground text-sm'>{t('plans.description')}</p>
      </div>
      {summary.plans.length === 0 ? (
        <p className='text-muted-foreground text-sm'>{t('plans.empty')}</p>
      ) : (
        <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
          {summary.plans.map((p, i) => {
            const current = p.key === summary.plan.key;
            const requested = summary.pending_request?.plan_key === p.key;
            const price = priceLine(p);
            const tagline = p.description || taglineFor(t, p.key);
            return (
              <Card
                key={p.key}
                className={cn('flex flex-col', current && 'border-primary ring-primary/20 ring-2')}
              >
                <CardHeader>
                  <CardTitle className='flex items-center justify-between gap-2'>
                    {p.name}
                    {current && <Badge>{t('plans.current')}</Badge>}
                    {requested && <Badge variant='secondary'>{t('plans.requested')}</Badge>}
                  </CardTitle>
                  {tagline && <CardDescription>{tagline}</CardDescription>}
                  {price && (
                    <p
                      className={cn(
                        'pt-2 font-semibold tabular-nums',
                        p.price_state === 'unset' ? 'text-muted-foreground text-sm' : 'text-xl'
                      )}
                    >
                      {price}
                    </p>
                  )}
                </CardHeader>
                <CardContent className='flex-1 space-y-4 text-sm'>
                  <ul className='space-y-1.5'>
                    {LIMIT_KEYS.filter((k) => k in p.limits).map((k) => (
                      <li key={k} className='flex justify-between gap-2'>
                        <span className='text-muted-foreground'>{t(`limits.${k}`)}</span>
                        <span className='font-medium tabular-nums'>
                          {limitValue(k, p.limits[k])}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {p.features.length > 0 && (
                    <div>
                      <p className='text-muted-foreground mb-1.5 text-xs font-medium uppercase'>
                        {t('plans.featuresTitle')}
                      </p>
                      <ul className='space-y-1'>
                        {p.features.map((f) => (
                          <li key={f} className='flex items-start gap-2'>
                            <Icons.check
                              className='text-primary mt-0.5 size-4 shrink-0'
                              aria-hidden
                            />
                            {t.has(`features.${f}` as never) ? t(`features.${f}` as never) : f}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
                <CardFooter>
                  {current ? (
                    <Button variant='outline' className='w-full' disabled>
                      {t('plans.current')}
                    </Button>
                  ) : requested ? (
                    <Button variant='secondary' className='w-full' disabled>
                      <Icons.clock className='size-4' aria-hidden />
                      {t('plans.requested')}
                    </Button>
                  ) : summary.can_manage ? (
                    <Button
                      className='w-full'
                      variant={i > currentIndex ? 'default' : 'outline'}
                      onClick={() => setAsking(p)}
                    >
                      {i > currentIndex ? t('plans.upgrade') : t('plans.switch')}
                    </Button>
                  ) : (
                    <p className='text-muted-foreground text-xs'>{t('plans.askAdmin')}</p>
                  )}
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}
      <UpgradeDialog
        plan={asking}
        organizationId={organizationId}
        onOpenChange={(open) => !open && setAsking(null)}
      />
    </section>
  );
}

function UpgradeDialog({
  plan,
  organizationId,
  onOpenChange
}: {
  plan: PlanSummary | null;
  organizationId: string;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('billing.plans');
  const tv = useTranslations('validation');
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const schema = useMemo(
    () =>
      z.object({
        message: z
          .string()
          .trim()
          .max(1000, { message: tv('maxLength', { max: 1000 }) })
      }),
    [tv]
  );
  const request = useMutation({
    mutationFn: (vars: { planKey: string; message: string }) =>
      requestPlanUpgrade(organizationId, vars.planKey, vars.message),
    onSuccess: (result) => {
      toast.success(result.status === 'already' ? t('alreadySent') : t('sent'));
      void queryClient.invalidateQueries({
        queryKey: billingKeys.org(organizationId)
      });
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e, 'saveFailed'))
  });
  const form = useAppForm({
    defaultValues: { message: '' },
    validators: { onSubmit: schema },
    onSubmit: async ({ value, formApi }) => {
      if (!plan) return;
      await request.mutateAsync({
        planKey: plan.key,
        message: value.message.trim()
      });
      formApi.reset();
    }
  });

  return (
    <Dialog open={!!plan} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{t('dialogTitle', { plan: plan?.name ?? '' })}</DialogTitle>
          <DialogDescription>{t('dialogDescription')}</DialogDescription>
        </DialogHeader>
        <form
          id='upgrade-request-form'
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit().catch(() => undefined);
          }}
        >
          <form.AppField
            name='message'
            children={(field) => (
              <field.TextareaField
                label={t('message')}
                placeholder={t('messagePlaceholder')}
                maxLength={1000}
                rows={3}
              />
            )}
          />
        </form>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <LoadingButton type='submit' form='upgrade-request-form' loading={request.isPending}>
            {t('send')}
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
import { createClient } from '@/lib/supabase/client';
import { createPlanCharge, requestPlanUpgrade, startOnlinePayment } from '../api/service';
import {
  LIMIT_KEYS,
  type BillingSummary,
  type OnlinePaymentMethod,
  type PlanSummary
} from '../api/types';
import { formatMoney } from '../lib/format';
import { taglineFor } from './plan-card';

/**
 * Plan cards with limits and features. A plan with a price is paid online (the
 * first month; the plan changes once the payment is received); a plan without a
 * price, or when online payment is off, is asked of LevelUp.
 */
export function PlanComparison({
  summary,
  organizationId,
  onlinePayments = []
}: {
  summary: BillingSummary;
  organizationId: string;
  onlinePayments?: OnlinePaymentMethod[];
}) {
  const t = useTranslations('billing');
  const format = useFormatter();
  const [asking, setAsking] = useState<PlanSummary | null>(null);
  const [paying, setPaying] = useState<PlanSummary | null>(null);
  const payable = (p: PlanSummary) =>
    onlinePayments.length > 0 && p.price_state === 'set' && !!p.price && !!p.currency;
  const currentIndex = summary.plans.findIndex((p) => p.key === summary.plan.key);

  const limitValue = (key: (typeof LIMIT_KEYS)[number], v: number | null | undefined) => {
    // Storage is never promised as a number: LevelUp sizes it to each client.
    if (key === 'media_mb') return t('limits.storageIncluded');
    if (v === null || v === undefined) return t('limits.unlimited');
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
        <p className='text-muted-foreground text-sm'>
          {onlinePayments.length ? t('plans.description') : t('plans.descriptionRequest')}
        </p>
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
                      onClick={() => (payable(p) ? setPaying(p) : setAsking(p))}
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
      <PayPlanDialog
        plan={paying}
        organizationId={organizationId}
        methods={onlinePayments}
        onOpenChange={(open) => !open && setPaying(null)}
      />
      <UpgradeDialog
        plan={asking}
        organizationId={organizationId}
        onOpenChange={(open) => !open && setAsking(null)}
      />
    </section>
  );
}

/** First month of a priced plan, paid on the secure payment page (card or PayPal). */
function PayPlanDialog({
  plan,
  organizationId,
  methods,
  onOpenChange
}: {
  plan: PlanSummary | null;
  organizationId: string;
  methods: OnlinePaymentMethod[];
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('billing.plans');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const pay = useMutation({
    mutationFn: async (method: OnlinePaymentMethod) => {
      if (!plan) throw new Error('no plan');
      const charge = await createPlanCharge(createClient(), organizationId, plan.key);
      void queryClient.invalidateQueries({ queryKey: billingKeys.org(organizationId) });
      return startOnlinePayment(charge.charge_id, method);
    },
    onSuccess: (url) => window.location.assign(url),
    onError: (e) => {
      const alternative = (e as { cause?: { alternative?: OnlinePaymentMethod | null } }).cause
        ?.alternative;
      if (alternative && methods.includes(alternative)) {
        toast.error(t('payTryOther'), {
          action: {
            label: alternative === 'paypal' ? t('payPaypal') : t('payCard'),
            onClick: () => pay.mutate(alternative)
          }
        });
        return;
      }
      toast.error(errorMessage(e, 'paymentUnavailable'));
    }
  });

  return (
    <Dialog open={!!plan} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>{t('payTitle', { plan: plan?.name ?? '' })}</DialogTitle>
          <DialogDescription>{t('payDescription')}</DialogDescription>
        </DialogHeader>
        {plan?.price && plan.currency && (
          <p className='text-2xl font-semibold tabular-nums'>
            {t('payAmount', { price: formatMoney(format.number, plan.price, plan.currency) })}
          </p>
        )}
        <div className='grid gap-2'>
          {methods.map((method) => (
            <LoadingButton
              key={method}
              variant={method === methods[0] ? 'default' : 'outline'}
              loading={pay.isPending && pay.variables === method}
              disabled={pay.isPending}
              onClick={() => pay.mutate(method)}
            >
              {method === 'paypal' ? t('payPaypal') : t('payCard')}
            </LoadingButton>
          ))}
        </div>
        {methods.includes('card') && (
          <p className='text-muted-foreground text-xs'>{t('payNote')}</p>
        )}
      </DialogContent>
    </Dialog>
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

'use client';

import type { OnlinePaymentMethod } from '../api/types';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { billingSummaryQueryOptions, billingUsageQueryOptions } from '../api/queries';
import { ChargesCard } from './charges-card';
import { CurrentPlanCard } from './plan-card';
import { PlanComparison } from './plan-comparison';
import { PromoCodeCard } from './promo-code-card';
import { LimitMeters, UsagePanel } from './usage-cards';

/**
 * Client Billing page. Everyone in the organization sees the plan, its limits
 * and this month's usage; owners and admins (`money` is only returned to them
 * by the database) also see prices, discounts, what they owe and the promo code.
 */
export function BillingView({
  organizationId,
  onlinePayments = []
}: {
  organizationId: string;
  /** Online payment switched on by the server (never the keys, only this flag). */
  onlinePayments?: OnlinePaymentMethod[];
}) {
  const db = createClient();
  const { data: summary } = useSuspenseQuery(billingSummaryQueryOptions(db, organizationId));
  const { data: usage } = useSuspenseQuery(billingUsageQueryOptions(db, organizationId));

  return (
    <div className='space-y-6'>
      <div className='grid gap-6 lg:grid-cols-2'>
        <CurrentPlanCard summary={summary} />
        <LimitMeters usage={summary.usage} />
      </div>
      <UsagePanel usage={usage} />
      {summary.money && <ChargesCard money={summary.money} onlinePayments={onlinePayments} />}
      <PlanComparison
        summary={summary}
        organizationId={organizationId}
        onlinePayments={onlinePayments}
      />
      {summary.can_manage && (
        <div className='max-w-xl'>
          <PromoCodeCard organizationId={organizationId} />
        </div>
      )}
    </div>
  );
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { rpc } from '@/lib/supabase/rpc-error';
import type { RangeDays, PaymentsSummary } from '@/features/insights/api/types';
import type { Payment, PaymentDetail, PaymentFilters, PaymentPage } from './types';

// Customer details come only through these SECURITY DEFINER functions, which
// mask them for viewers; the table itself never exposes them to the browser.

export function listPayments(db: SupabaseClient, websiteId: string, filters: PaymentFilters) {
  return rpc<PaymentPage>(
    db.rpc('site_payments_list', {
      p_website_id: websiteId,
      p_search: filters.search,
      p_status: filters.status.length ? filters.status : null,
      p_livemode: filters.live,
      p_sort: filters.sort,
      p_desc: filters.desc,
      p_limit: filters.perPage,
      p_offset: (filters.page - 1) * filters.perPage
    })
  );
}

export function getPaymentDetail(db: SupabaseClient, paymentId: string) {
  return rpc<PaymentDetail>(db.rpc('site_payment_detail', { p_payment_id: paymentId }));
}

export function getPaymentsSummary(
  db: SupabaseClient,
  websiteId: string,
  days: RangeDays,
  live = true
) {
  return rpc<PaymentsSummary>(
    db.rpc('site_payments_summary', { p_website_id: websiteId, p_days: days, p_livemode: live })
  );
}

/** Owner / admin: every payment matching the filters, with customer details (audited). */
export function exportPayments(
  db: SupabaseClient,
  websiteId: string,
  filters: Pick<PaymentFilters, 'status' | 'live'>
) {
  return rpc<Payment[]>(
    db.rpc('site_payments_export', {
      p_website_id: websiteId,
      p_status: filters.status.length ? filters.status : null,
      p_livemode: filters.live
    })
  );
}

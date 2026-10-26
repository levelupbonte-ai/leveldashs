import type { SupabaseClient } from '@supabase/supabase-js';
import { billingError } from '@/features/billing/api/service';
import type { ChargeRow } from '@/features/billing/api/types';
import type {
  BillingOrgRow,
  ChargeInput,
  DiscountInput,
  DiscountRow,
  OrgBillingDetail,
  OrgBillingInput,
  PlanRow,
  UpgradeRequestRow
} from './types';

// LevelUp staff only. Every write is a SECURITY DEFINER function that checks
// the caller is a platform admin on an aal2 session and writes hq_audit_log;
// amounts and discounts are computed by the database, never here.

export async function listBillingOrgs(db: SupabaseClient): Promise<BillingOrgRow[]> {
  const { data, error } = await db.rpc('admin_list_billing_orgs');
  if (error) throw billingError(error, 'loadFailed');
  return (data ?? []) as BillingOrgRow[];
}

export async function getOrgBilling(
  db: SupabaseClient,
  organizationId: string
): Promise<OrgBillingDetail> {
  const { data, error } = await db.rpc('admin_get_org_billing', { p_org: organizationId });
  if (error) throw billingError(error, 'loadFailed');
  return data as OrgBillingDetail;
}

export async function setOrgBilling(db: SupabaseClient, input: OrgBillingInput) {
  const { error } = await db.rpc('admin_set_org_billing', {
    p_org: input.organizationId,
    p_plan_key: input.planKey,
    p_status: input.status,
    p_custom_price: input.customPrice,
    p_currency: input.currency.toLowerCase(),
    p_note: input.note.trim() || null,
    p_next_due_date: input.nextDueDate || null
  });
  if (error) throw billingError(error, 'saveFailed');
}

export async function createCharge(db: SupabaseClient, input: ChargeInput): Promise<ChargeRow> {
  const { data, error } = await db.rpc('admin_create_charge', {
    p_org: input.organizationId,
    p_kind: input.kind,
    p_label: input.label,
    p_description: input.description.trim() || null,
    p_amount: input.amount,
    p_currency: input.currency.toLowerCase(),
    p_due_date: input.dueDate || null,
    p_apply_discount: input.applyDiscount
  });
  if (error) throw billingError(error, 'saveFailed');
  return data as ChargeRow;
}

export async function updateCharge(
  db: SupabaseClient,
  id: string,
  input: Pick<ChargeInput, 'label' | 'description' | 'amount' | 'dueDate' | 'applyDiscount'>
): Promise<ChargeRow> {
  const { data, error } = await db.rpc('admin_update_charge', {
    p_id: id,
    p_label: input.label,
    p_description: input.description.trim() || null,
    p_amount: input.amount,
    p_due_date: input.dueDate || null,
    p_apply_discount: input.applyDiscount
  });
  if (error) throw billingError(error, 'saveFailed');
  return data as ChargeRow;
}

export async function voidCharge(db: SupabaseClient, id: string) {
  const { error } = await db.rpc('admin_void_charge', { p_id: id, p_reason: null });
  if (error) throw billingError(error, 'saveFailed');
}

export async function markChargePaid(
  db: SupabaseClient,
  id: string,
  paidOn: string | null,
  note: string
) {
  const { error } = await db.rpc('admin_mark_charge_paid', {
    p_id: id,
    // Noon local time of the chosen day, so the date never shifts with the time zone.
    p_paid_at: paidOn ? new Date(`${paidOn}T12:00:00`).toISOString() : null,
    p_note: note.trim() || null
  });
  if (error) throw billingError(error, 'saveFailed');
}

export async function listPlans(db: SupabaseClient): Promise<PlanRow[]> {
  const { data, error } = await db
    .from('plans')
    .select(
      'key, name, description, price_monthly, currency, limits, features, sort_order, active, is_default'
    )
    .order('sort_order')
    .order('key');
  if (error) throw billingError(error, 'loadFailed');
  return (data ?? []) as PlanRow[];
}

export async function savePlan(db: SupabaseClient, plan: PlanRow) {
  const { error } = await db.rpc('admin_save_plan', {
    p_key: plan.key,
    p_name: plan.name,
    p_description: plan.description?.trim() || null,
    p_price: plan.price_monthly,
    p_currency: plan.currency.toLowerCase(),
    p_limits: plan.limits,
    p_features: plan.features,
    p_sort_order: plan.sort_order,
    p_active: plan.active,
    p_is_default: plan.is_default
  });
  if (error) throw billingError(error, 'saveFailed');
}

export async function listDiscounts(db: SupabaseClient): Promise<DiscountRow[]> {
  const { data, error } = await db
    .from('discounts')
    .select(
      'id, organization_id, code, label, kind, value, currency, applies_to, starts_at, ends_at, active, max_uses, uses, created_at, organizations (name)'
    )
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw billingError(error, 'loadFailed');
  return (data ?? []).map((d) => {
    const { organizations, ...row } = d as typeof d & { organizations: { name: string } | null };
    return { ...row, organization_name: organizations?.name ?? null } as DiscountRow;
  });
}

export async function saveDiscount(db: SupabaseClient, input: DiscountInput): Promise<string> {
  const { data, error } = await db.rpc('admin_save_discount', {
    p_id: input.id,
    p_org: input.organizationId,
    p_code: input.code.trim() || null,
    p_label: input.label,
    p_kind: input.kind,
    p_value: input.value,
    p_currency: input.kind === 'fixed' ? input.currency?.toLowerCase() : null,
    p_applies_to: input.appliesTo,
    p_starts_at: input.startsAt ? new Date(`${input.startsAt}T00:00:00`).toISOString() : null,
    p_ends_at: input.endsAt ? new Date(`${input.endsAt}T23:59:59`).toISOString() : null,
    p_max_uses: input.maxUses,
    p_active: input.active
  });
  if (error) throw billingError(error, 'saveFailed');
  return data as string;
}

export async function setDiscountActive(db: SupabaseClient, id: string, active: boolean) {
  const { error } = await db.rpc('admin_set_discount_active', { p_id: id, p_active: active });
  if (error) throw billingError(error, 'saveFailed');
}

export async function listUpgradeRequests(db: SupabaseClient): Promise<UpgradeRequestRow[]> {
  const { data, error } = await db.rpc('admin_list_upgrade_requests');
  if (error) throw billingError(error, 'loadFailed');
  return (data ?? []) as UpgradeRequestRow[];
}

export async function decideUpgradeRequest(db: SupabaseClient, id: string, approve: boolean) {
  const { error } = await db.rpc('admin_decide_upgrade_request', {
    p_id: id,
    p_approve: approve,
    p_note: null
  });
  if (error) throw billingError(error, 'saveFailed');
}

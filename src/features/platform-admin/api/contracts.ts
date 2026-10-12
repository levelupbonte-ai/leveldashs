import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError, isMfaError } from '@/lib/errors';
import type {
  AdminContractInput,
  AdminContractRow,
  AdminContractTemplate,
  PublishTemplateInput
} from './types';
import type { RequiredTask } from '@/lib/auth/types';

// LevelUp staff only: contracts are written through platform-admin RPCs that
// check the caller (platform_admins + aal2) in the database.

function rpcError(
  error: { code?: string; message?: string },
  fallback: 'saveFailed' | 'createFailed'
) {
  if (isMfaError(error)) return new AppError('mfaRequired', { cause: error });
  if (error.code === 'PT403') return new AppError('forbidden', { cause: error });
  if (error.code === 'PT409') return new AppError('alreadyExists', { cause: error });
  if (error.code === '22023') return new AppError('invalidValues', { cause: error });
  return new AppError(fallback, { cause: error });
}

export async function listContractTemplates(db: SupabaseClient): Promise<AdminContractTemplate[]> {
  const { data, error } = await db
    .from('contract_templates')
    .select('id, key, version, locale, title, published_at')
    .order('key')
    .order('version', { ascending: false })
    .order('locale');
  if (error) throw new AppError('loadFailed', { cause: error });
  return (data ?? []).map((t) => ({
    id: t.id,
    key: t.key,
    version: t.version,
    locale: t.locale,
    title: t.title,
    publishedAt: t.published_at
  }));
}

export async function listOrgContracts(
  db: SupabaseClient,
  organizationId: string
): Promise<AdminContractRow[]> {
  const { data, error } = await db
    .from('contracts')
    .select(
      'id, organization_id, website_id, template_key, template_version, title, locale, status, required, created_at, sent_at, signed_at, void_reason, contract_signatures (signer_name)'
    )
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false });
  if (error) throw new AppError('loadFailed', { cause: error });
  return (data ?? []).map((c) => {
    const sig = c.contract_signatures as unknown as
      | { signer_name: string }
      | { signer_name: string }[]
      | null;
    const signer = Array.isArray(sig) ? sig[0] : sig;
    return {
      id: c.id,
      organizationId: c.organization_id,
      websiteId: c.website_id,
      templateKey: c.template_key,
      templateVersion: c.template_version,
      title: c.title,
      locale: c.locale,
      status: c.status,
      required: c.required,
      createdAt: c.created_at,
      sentAt: c.sent_at,
      signedAt: c.signed_at,
      voidReason: c.void_reason,
      signerName: signer?.signer_name ?? null
    };
  });
}

export async function listRequiredTasks(
  db: SupabaseClient,
  organizationId: string
): Promise<RequiredTask[]> {
  const { data, error } = await db
    .from('organization_required_tasks')
    .select('task, required')
    .eq('organization_id', organizationId);
  if (error) throw new AppError('loadFailed', { cause: error });
  return (data ?? []).filter((t) => t.required).map((t) => t.task as RequiredTask);
}

export async function createContract(db: SupabaseClient, input: AdminContractInput) {
  const { data, error } = await db.rpc('admin_create_contract', {
    p_organization_id: input.organizationId,
    p_template_key: 'msa',
    p_website_id: input.websiteId,
    p_locale: input.locale,
    p_order_form: input.orderForm,
    p_required: input.required
  });
  if (error) throw rpcError(error, 'createFailed');
  return data as string;
}

export async function updateContract(db: SupabaseClient, id: string, input: AdminContractInput) {
  const { error } = await db.rpc('admin_update_contract', {
    p_contract_id: id,
    p_order_form: input.orderForm,
    p_required: input.required,
    p_website_id: input.websiteId,
    p_locale: input.locale
  });
  if (error) throw rpcError(error, 'saveFailed');
}

/** Sends through the route handler, which also e-mails the client's owners/admins. */
export async function sendContract(id: string): Promise<{ notified: number; recipients: number }> {
  const res = await fetch(`/api/contracts/${encodeURIComponent(id)}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  }).catch(() => null);
  if (!res) throw new AppError('network');
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    notified?: number;
    recipients?: number;
  };
  if (!res.ok) {
    throw new AppError(
      body.error === 'mfa' ? 'mfaRequired' : body.error === 'forbidden' ? 'forbidden' : 'saveFailed'
    );
  }
  return { notified: body.notified ?? 0, recipients: body.recipients ?? 0 };
}

export async function voidContract(db: SupabaseClient, id: string, reason: string) {
  const { error } = await db.rpc('admin_void_contract', { p_contract_id: id, p_reason: reason });
  if (error) throw rpcError(error, 'saveFailed');
}

export async function setContractRequired(db: SupabaseClient, id: string, required: boolean) {
  const { error } = await db.rpc('admin_set_contract_required', {
    p_contract_id: id,
    p_required: required
  });
  if (error) throw rpcError(error, 'saveFailed');
}

export async function reissueContract(db: SupabaseClient, id: string) {
  const { data, error } = await db.rpc('admin_reissue_contract', { p_contract_id: id });
  if (error) throw rpcError(error, 'createFailed');
  return data as string;
}

export async function setRequiredTasks(
  db: SupabaseClient,
  organizationId: string,
  tasks: RequiredTask[]
) {
  const { error } = await db.rpc('admin_set_required_tasks', {
    p_organization_id: organizationId,
    p_tasks: tasks
  });
  if (error) throw rpcError(error, 'saveFailed');
}

export async function publishTemplate(db: SupabaseClient, input: PublishTemplateInput) {
  const { data, error } = await db.rpc('admin_publish_contract_template', {
    p_key: input.key,
    p_locale: input.locale,
    p_title: input.title,
    p_body: input.body,
    p_version: input.version
  });
  if (error) throw rpcError(error, 'saveFailed');
  return data as number;
}

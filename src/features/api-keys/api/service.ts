import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '@/lib/errors';
import { rpc, toAppError } from '@/lib/supabase/rpc-error';
import { fields } from '@/lib/validation/fields';
import {
  KEY_SCOPES,
  type CreateKeyInput,
  type CreatedApiKey,
  type DeveloperActivity,
  type SiteApiKey
} from './types';

// Owners and admins only (RLS on site_api_keys and site_audit_log, checks inside
// the functions). Creating and revoking are written to the site audit log by the
// database. Viewers and editors get empty lists.

/** Display names of members (profiles are readable for people sharing an organization). */
async function memberNames(db: SupabaseClient, ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (!unique.length) return new Map<string, string>();
  const { data, error } = await db.from('profiles').select('id, full_name, email').in('id', unique);
  if (error) throw toAppError(error);
  return new Map(
    (data ?? []).map((p: { id: string; full_name: string | null; email: string | null }) => [
      p.id,
      p.full_name?.trim() || p.email || ''
    ])
  );
}

export async function listApiKeys(db: SupabaseClient, websiteId: string): Promise<SiteApiKey[]> {
  const { data, error } = await db
    .from('site_api_keys')
    .select('id, name, prefix, key_hint, scopes, created_by, created_at, last_used_at, revoked_at')
    .eq('website_id', websiteId)
    .order('revoked_at', { ascending: false, nullsFirst: true })
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw toAppError(error);
  const rows = (data ?? []) as Omit<SiteApiKey, 'created_by_name'>[];
  const names = await memberNames(
    db,
    rows.map((k) => k.created_by)
  );
  return rows.map((k) => ({
    ...k,
    created_by_name: (k.created_by && names.get(k.created_by)) || null
  }));
}

const text = (v: unknown) => (typeof v === 'string' && v ? v : null);

/** Latest key / export events (audit log) and payment events received from the site's server. */
export async function listDeveloperActivity(
  db: SupabaseClient,
  websiteId: string
): Promise<DeveloperActivity[]> {
  const [audit, events] = await Promise.all([
    db
      .from('site_audit_log')
      .select('id, action, actor_id, metadata, created_at')
      .eq('website_id', websiteId)
      .order('created_at', { ascending: false })
      .limit(25),
    db
      .from('site_payment_events')
      .select('id, provider_event_id, status, applied, received_at')
      .eq('website_id', websiteId)
      .order('received_at', { ascending: false })
      .limit(25)
  ]);
  if (audit.error) throw toAppError(audit.error);
  if (events.error) throw toAppError(events.error);
  type AuditRow = {
    id: number;
    action: string;
    actor_id: string | null;
    metadata: { name?: unknown; prefix?: unknown; key_hint?: unknown } | null;
    created_at: string;
  };
  type EventRow = {
    id: number | string;
    provider_event_id: string;
    status: string;
    applied: boolean;
    received_at: string;
  };
  const auditRows = (audit.data ?? []) as AuditRow[];
  const names = await memberNames(
    db,
    auditRows.map((a) => a.actor_id)
  );
  const items: DeveloperActivity[] = [
    ...auditRows.map((a) => {
      const prefix = text(a.metadata?.prefix);
      const hint = text(a.metadata?.key_hint);
      return {
        kind: 'audit' as const,
        id: `a${a.id}`,
        at: a.created_at,
        action: a.action,
        actor: (a.actor_id && names.get(a.actor_id)) || null,
        keyName: text(a.metadata?.name),
        keyHint: prefix && hint ? `${prefix}…${hint}` : null
      };
    }),
    ...((events.data ?? []) as EventRow[]).map((e) => ({
      kind: 'payment_event' as const,
      id: `e${e.id}`,
      at: e.received_at,
      status: e.status,
      applied: e.applied,
      eventId: e.provider_event_id
    }))
  ];
  return items.toSorted((x, y) => y.at.localeCompare(x.at)).slice(0, 30);
}

export async function createApiKey(
  db: SupabaseClient,
  websiteId: string,
  input: CreateKeyInput
): Promise<CreatedApiKey> {
  const name = fields.text(80, { min: 1 }).safeParse(input.name);
  const scopes = [...new Set(input.scopes)].filter((s) => KEY_SCOPES.includes(s));
  if (!name.success || !scopes.length || !['live', 'test'].includes(input.mode)) {
    throw new AppError('invalidValues');
  }
  return rpc<CreatedApiKey>(
    db.rpc('site_create_api_key', {
      p_website_id: websiteId,
      p_name: name.data,
      p_mode: input.mode,
      p_scopes: scopes
    })
  );
}

export async function revokeApiKey(db: SupabaseClient, keyId: string) {
  await rpc<null>(db.rpc('site_revoke_api_key', { p_key_id: keyId }));
}

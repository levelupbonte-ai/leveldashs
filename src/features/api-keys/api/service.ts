import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '@/lib/errors';
import { rpc, toAppError } from '@/lib/supabase/rpc-error';
import { fields } from '@/lib/validation/fields';
import { KEY_SCOPES, type CreateKeyInput, type CreatedApiKey, type SiteApiKey } from './types';

// Owners and admins only (RLS on site_api_keys, checks inside the functions).
// Creating and revoking are written to the site audit log by the database.

export async function listApiKeys(db: SupabaseClient, websiteId: string): Promise<SiteApiKey[]> {
  const { data, error } = await db
    .from('site_api_keys')
    .select('id, name, prefix, key_hint, scopes, created_at, last_used_at, revoked_at')
    .eq('website_id', websiteId)
    .order('revoked_at', { ascending: false, nullsFirst: true })
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw toAppError(error);
  return (data ?? []) as SiteApiKey[];
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

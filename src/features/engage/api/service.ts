import type { SupabaseClient } from '@supabase/supabase-js';
import { rpc, toAppError } from '@/lib/supabase/rpc-error';
import type {
  Campaign,
  CampaignInput,
  CampaignStatus,
  ConfigKind,
  ConfigValue,
  PromoCode,
  PromoInput
} from './types';

// Marketing tools of the active website. Every read and write goes through
// the site_* functions (viewer reads, editor+ writes, audited); the LevelUp tag
// reads what is live through the cached site bundle.

export function getCampaigns(db: SupabaseClient, websiteId: string) {
  return rpc<Campaign[]>(db.rpc('site_campaigns_list', { p_website_id: websiteId }));
}

export function saveCampaign(
  db: SupabaseClient,
  websiteId: string,
  id: string | null,
  campaign: CampaignInput
) {
  return rpc<string>(
    db.rpc('site_campaign_save', { p_website_id: websiteId, p_id: id, p_campaign: campaign })
  );
}

export function setCampaignStatus(db: SupabaseClient, id: string, status: CampaignStatus) {
  return rpc<null>(db.rpc('site_campaign_set_status', { p_id: id, p_status: status }));
}

export async function getConfigValues(db: SupabaseClient, websiteId: string) {
  const { data, error } = await db
    .from('site_config_values')
    .select('key, kind, value, description, updated_at')
    .eq('website_id', websiteId)
    .order('key');
  if (error) throw toAppError(error);
  return (data ?? []) as ConfigValue[];
}

export function setConfigValue(
  db: SupabaseClient,
  websiteId: string,
  input: { key: string; kind: ConfigKind; value: unknown; description: string }
) {
  return rpc<null>(
    db.rpc('site_config_set', {
      p_website_id: websiteId,
      p_key: input.key,
      p_kind: input.kind,
      p_value: input.value,
      p_description: input.description || null
    })
  );
}

export function deleteConfigValue(db: SupabaseClient, websiteId: string, key: string) {
  return rpc<null>(db.rpc('site_config_delete', { p_website_id: websiteId, p_key: key }));
}

export function getPromoCodes(db: SupabaseClient, websiteId: string) {
  return rpc<PromoCode[]>(db.rpc('site_promo_list', { p_website_id: websiteId }));
}

export function savePromoCode(
  db: SupabaseClient,
  websiteId: string,
  id: string | null,
  promo: PromoInput
) {
  return rpc<string>(
    db.rpc('site_promo_save', { p_website_id: websiteId, p_id: id, p_promo: promo })
  );
}

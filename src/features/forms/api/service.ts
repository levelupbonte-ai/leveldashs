import type { SupabaseClient } from '@supabase/supabase-js';
import { rpc } from '@/lib/supabase/rpc-error';
import type { SiteForm, SiteFormInput } from './types';

// Runs as the signed-in user: the functions check the role (viewer reads,
// editor saves) and validate every field again.

export async function listForms(db: SupabaseClient, websiteId: string) {
  return (
    (await rpc<SiteForm[] | null>(db.rpc('site_forms_list', { p_website_id: websiteId }))) ?? []
  );
}

export function saveForm(db: SupabaseClient, websiteId: string, input: SiteFormInput) {
  return rpc<SiteForm>(
    db.rpc('site_form_save', {
      p_website_id: websiteId,
      p_form_id: input.id,
      p_name: input.name,
      p_form_type: input.form_type,
      p_status: input.status,
      p_fields: input.fields,
      p_settings: input.settings
    })
  );
}

export function archiveForm(db: SupabaseClient, formId: string) {
  return rpc<null>(db.rpc('site_form_archive', { p_form_id: formId }));
}

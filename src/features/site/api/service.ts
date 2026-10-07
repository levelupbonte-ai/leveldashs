import type { SupabaseClient } from '@supabase/supabase-js';
import type { CollectionDef } from '../config/collections';
import type {
  Appointment,
  AppointmentStatus,
  ContentBlock,
  ContentRow,
  FormSubmission,
  MediaItem,
  SiteOverview,
  SeoSettings,
  SubmissionStatus,
  WaitlistEntry,
  WebsiteIntegration,
  WaitlistStatus,
  WebsiteSetting
} from './types';

// Every call runs with the signed-in user's token: Row Level Security decides
// what can be read or written. website_id / organization_id filters only pick
// the active website among the rows the user is allowed to see.

export interface SiteScope {
  websiteId: string;
  organizationId: string;
}

export class SiteServiceError extends Error {
  constructor(
    message: string,
    readonly code?: string
  ) {
    super(message);
  }
}

function fail(error: { message: string; code?: string } | null): never {
  const code = error?.code;
  if (code === '42501' || code === 'PGRST301') {
    throw new SiteServiceError('Vous n’avez pas les droits pour cette action.', code);
  }
  if (code === '23505') throw new SiteServiceError('Cet élément existe déjà.', code);
  if (code === '23514' || code === '22023') {
    throw new SiteServiceError('Certaines valeurs ne sont pas valides.', code);
  }
  throw new SiteServiceError('Une erreur est survenue. Réessayez.', code);
}

// ---------------------------------------------------------------- collections

export async function listCollection(
  db: SupabaseClient,
  def: CollectionDef,
  websiteId: string
): Promise<ContentRow[]> {
  const { data, error } = await db
    .from(def.table)
    .select('*')
    .eq('website_id', websiteId)
    .order(def.orderBy.column, { ascending: def.orderBy.ascending })
    .order('created_at', { ascending: true })
    .limit(500);
  if (error) fail(error);
  return (data ?? []) as ContentRow[];
}

export function slugify(value: string): string {
  const base = value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56)
    .replace(/-+$/g, '');
  return base || 'item';
}

function pick(def: CollectionDef, values: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const field of def.fields) {
    if (field.name in values) out[field.name] = values[field.name];
  }
  return out;
}

export async function createCollectionItem(
  db: SupabaseClient,
  def: CollectionDef,
  scope: SiteScope,
  values: Record<string, unknown>
): Promise<ContentRow> {
  const row: Record<string, unknown> = {
    ...pick(def, values),
    website_id: scope.websiteId,
    organization_id: scope.organizationId
  };
  const base = def.slugFrom ? slugify(String(values[def.slugFrom] ?? '')) : null;

  for (let attempt = 0; attempt < 4; attempt++) {
    if (base) {
      row.slug = attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    }
    const { data, error } = await db.from(def.table).insert(row).select('*').single();
    if (!error) return data as ContentRow;
    if (!(base && error.code === '23505')) fail(error);
  }
  throw new SiteServiceError('Impossible de générer un identifiant unique.');
}

export async function updateCollectionItem(
  db: SupabaseClient,
  def: CollectionDef,
  id: string,
  values: Record<string, unknown>
): Promise<ContentRow> {
  const { data, error } = await db
    .from(def.table)
    .update(pick(def, values))
    .eq('id', id)
    .select('*')
    .single();
  if (error) fail(error);
  return data as ContentRow;
}

export async function deleteCollectionItem(db: SupabaseClient, def: CollectionDef, id: string) {
  const { error, count } = await db.from(def.table).delete({ count: 'exact' }).eq('id', id);
  if (error) fail(error);
  if (!count) throw new SiteServiceError('Vous n’avez pas les droits pour cette action.');
}

// ---------------------------------------------------------------- inbox

export const PAGE_SIZE = 50;
export type AppointmentView = 'upcoming' | 'past' | 'all';
export type SubmissionView = 'open' | 'all';

function pageRange(page: number): [number, number] {
  return [page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1];
}

export async function listAppointments(
  db: SupabaseClient,
  websiteId: string,
  view: AppointmentView = 'upcoming',
  page = 0
) {
  const today = new Date().toISOString().slice(0, 10);
  let query = db
    .from('appointments')
    .select(
      'id, ticket_code, customer_name, customer_email, customer_phone, service_name, price_label, team_member_name, appointment_date, appointment_time, notes, staff_notes, status, created_at'
    )
    .eq('website_id', websiteId);
  if (view === 'upcoming') {
    query = query
      .gte('appointment_date', today)
      .in('status', ['pending', 'confirmed'])
      .order('appointment_date', { ascending: true })
      .order('appointment_time', { ascending: true });
  } else {
    if (view === 'past') query = query.lt('appointment_date', today);
    query = query
      .order('appointment_date', { ascending: false })
      .order('appointment_time', { ascending: false });
  }
  const { data, error } = await query.range(...pageRange(page));
  if (error) fail(error);
  return (data ?? []) as Appointment[];
}

export async function updateAppointment(
  db: SupabaseClient,
  id: string,
  patch: { status?: AppointmentStatus; staff_notes?: string | null }
) {
  const { error } = await db.from('appointments').update(patch).eq('id', id);
  if (error) fail(error);
}

export async function listWaitlist(db: SupabaseClient, websiteId: string) {
  const { data, error } = await db
    .from('waitlist_entries')
    .select(
      'id, ticket_code, customer_name, customer_phone, customer_email, service_name, team_member_name, position, est_minutes, status, joined_at'
    )
    .eq('website_id', websiteId)
    .order('joined_at', { ascending: false })
    .limit(300);
  if (error) fail(error);
  return (data ?? []) as WaitlistEntry[];
}

export async function updateWaitlistEntry(db: SupabaseClient, id: string, status: WaitlistStatus) {
  const { error } = await db.from('waitlist_entries').update({ status }).eq('id', id);
  if (error) fail(error);
}

export async function listSubmissions(
  db: SupabaseClient,
  websiteId: string,
  view: SubmissionView = 'open',
  page = 0
) {
  let query = db
    .from('form_submissions')
    .select(
      'id, form_type, ticket_code, name, email, phone, company, message, data, status, staff_notes, source, created_at'
    )
    .eq('website_id', websiteId);
  if (view === 'open') query = query.in('status', ['new', 'contacted', 'in_progress', 'quoted']);
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .range(...pageRange(page));
  if (error) fail(error);
  return (data ?? []) as FormSubmission[];
}

export async function updateSubmission(
  db: SupabaseClient,
  id: string,
  patch: { status?: SubmissionStatus; staff_notes?: string | null }
) {
  const { error } = await db.from('form_submissions').update(patch).eq('id', id);
  if (error) fail(error);
}

// ---------------------------------------------------------------- media

const MEDIA_BUCKET = 'media';
export const MEDIA_MAX_BYTES = 10 * 1024 * 1024;
export const MEDIA_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'application/pdf': 'pdf',
  'video/mp4': 'mp4',
  'video/webm': 'webm'
};

export async function listMedia(
  db: SupabaseClient,
  websiteId: string,
  page = 0
): Promise<MediaItem[]> {
  const { data, error } = await db
    .from('media')
    .select('id, storage_path, filename, mime_type, size_bytes, alt_text, created_at')
    .eq('website_id', websiteId)
    .order('created_at', { ascending: false })
    .range(...pageRange(page));
  if (error) fail(error);
  return (data ?? []).map((m) => ({
    ...m,
    url: db.storage.from(MEDIA_BUCKET).getPublicUrl(m.storage_path).data.publicUrl
  })) as MediaItem[];
}

export async function uploadMedia(
  db: SupabaseClient,
  scope: SiteScope,
  file: File,
  altText?: string
): Promise<MediaItem> {
  const ext = MEDIA_TYPES[file.type];
  if (!ext) throw new SiteServiceError('Format non pris en charge (images, PDF, MP4, WebM).');
  if (file.size > MEDIA_MAX_BYTES)
    throw new SiteServiceError('Fichier trop lourd (10 Mo maximum).');

  const {
    data: { user }
  } = await db.auth.getUser();
  if (!user) throw new SiteServiceError('Session expirée. Reconnectez-vous.');

  const path = `${scope.organizationId}/${scope.websiteId}/${crypto.randomUUID()}.${ext}`;
  const upload = await db.storage
    .from(MEDIA_BUCKET)
    .upload(path, file, { contentType: file.type, cacheControl: '31536000', upsert: false });
  if (upload.error) {
    throw new SiteServiceError('Envoi impossible : vérifiez vos droits (éditeur requis).');
  }

  const { data, error } = await db
    .from('media')
    .insert({
      organization_id: scope.organizationId,
      website_id: scope.websiteId,
      bucket: MEDIA_BUCKET,
      storage_path: path,
      filename: file.name.slice(0, 255) || `upload.${ext}`,
      mime_type: file.type,
      size_bytes: file.size,
      alt_text: altText?.slice(0, 500) || null,
      created_by: user.id
    })
    .select('id, storage_path, filename, mime_type, size_bytes, alt_text, created_at')
    .single();
  if (error) {
    await db.storage.from(MEDIA_BUCKET).remove([path]);
    fail(error);
  }
  return {
    ...data,
    url: db.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl
  } as MediaItem;
}

export async function deleteMedia(
  db: SupabaseClient,
  item: Pick<MediaItem, 'id' | 'storage_path'>
) {
  const removed = await db.storage.from(MEDIA_BUCKET).remove([item.storage_path]);
  if (removed.error) throw new SiteServiceError('Suppression impossible.');
  const { error } = await db.from('media').delete().eq('id', item.id);
  if (error) fail(error);
}

// ---------------------------------------------------------------- settings & page content

export async function listSettings(db: SupabaseClient, websiteId: string) {
  const { data, error } = await db
    .from('website_settings')
    .select('key, value, is_public, updated_at')
    .eq('website_id', websiteId)
    .order('key');
  if (error) fail(error);
  return (data ?? []) as WebsiteSetting[];
}

export async function saveSetting(
  db: SupabaseClient,
  scope: SiteScope,
  key: string,
  value: unknown
) {
  const { error } = await db.from('website_settings').upsert(
    {
      website_id: scope.websiteId,
      organization_id: scope.organizationId,
      key,
      value
    },
    { onConflict: 'website_id,key' }
  );
  if (error) fail(error);
}

export async function listContentBlocks(db: SupabaseClient, websiteId: string) {
  const { data, error } = await db
    .from('content_blocks')
    .select('id, page, block_key, data, status, sort_order, updated_at')
    .eq('website_id', websiteId)
    .order('page')
    .order('sort_order')
    .order('block_key');
  if (error) fail(error);
  return (data ?? []) as ContentBlock[];
}

export async function updateContentBlock(
  db: SupabaseClient,
  id: string,
  patch: { data?: Record<string, unknown>; status?: string }
) {
  const { error } = await db.from('content_blocks').update(patch).eq('id', id);
  if (error) fail(error);
}

// ---------------------------------------------------------------- overview

const countOf = (res: { count: number | null }) => res.count ?? 0;

export async function getSiteOverview(
  db: SupabaseClient,
  websiteId: string
): Promise<SiteOverview> {
  const today = new Date().toISOString().slice(0, 10);
  const head = (table: string) =>
    db.from(table).select('id', { count: 'exact', head: true }).eq('website_id', websiteId);
  const [pending, upcoming, waitingRes, requests, files] = await Promise.all([
    head('appointments').eq('status', 'pending'),
    head('appointments').gte('appointment_date', today).in('status', ['pending', 'confirmed']),
    head('waitlist_entries').eq('status', 'waiting'),
    head('form_submissions').eq('status', 'new'),
    head('media')
  ]);
  const pendingAppointments = countOf(pending);
  const upcomingAppointments = countOf(upcoming);
  const waiting = countOf(waitingRes);
  const newRequests = countOf(requests);
  const media = countOf(files);
  return { pendingAppointments, upcomingAppointments, waiting, newRequests, media };
}

// ---------------------------------------------------------------- integration (LevelUp tag)

export async function getWebsiteIntegration(
  db: SupabaseClient,
  websiteId: string
): Promise<WebsiteIntegration> {
  const { data, error } = await db
    .from('websites')
    .select(
      'id, name, status, primary_domain, allowed_origins, show_powered_by, tag_last_seen_at, tag_last_seen_origin, tag_version'
    )
    .eq('id', websiteId)
    .single();
  if (error) fail(error);
  return data as WebsiteIntegration;
}

/** LevelUp staff only (admin_update_website checks platform_admins). */
export async function adminUpdateWebsite(
  db: SupabaseClient,
  websiteId: string,
  patch: {
    allowedOrigins?: string[];
    features?: string[];
    showPoweredBy?: boolean;
    status?: string;
    primaryDomain?: string;
  }
) {
  const { error } = await db.rpc('admin_update_website', {
    p_website_id: websiteId,
    p_allowed_origins: patch.allowedOrigins ?? null,
    p_features: patch.features ?? null,
    p_show_powered_by: patch.showPoweredBy ?? null,
    p_status: patch.status ?? null,
    p_primary_domain: patch.primaryDomain ?? null
  });
  if (error) {
    if (error.code === '22023')
      throw new SiteServiceError(error.message.replace(/^Invalid origin: /, 'Domaine invalide : '));
    fail(error);
  }
}

export async function getSeoSettings(db: SupabaseClient, websiteId: string): Promise<SeoSettings> {
  const { data, error } = await db
    .from('website_settings')
    .select('value')
    .eq('website_id', websiteId)
    .eq('key', 'seo')
    .maybeSingle();
  if (error) fail(error);
  return (data?.value as SeoSettings) ?? {};
}

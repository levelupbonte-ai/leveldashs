import type { SupabaseClient } from '@supabase/supabase-js';
import { assertFileSignature } from '@/lib/file-signature';
import { optimizeImage } from '@/lib/media/optimize-image';
import {
  MEDIA_CACHE_SECONDS,
  mediaObjectPath,
  storedFileName,
  thumbPathFor
} from '@/lib/media/paths';
import { rpc } from '@/lib/supabase/rpc-error';
import { AppError, isMfaError } from '@/lib/errors';
import { fields } from '@/lib/validation/fields';
import type { CollectionDef } from '../config/collections';
import { sanitizeRow } from '../components/item-form-schema';
import {
  cleanJson,
  cleanLine,
  findUnsafeJson,
  isWebOrigin,
  PATTERNS,
  safeFileName
} from '@/lib/validation/sanitize';
import type {
  Appointment,
  AppointmentStatus,
  ContentBlock,
  ContentRow,
  FormSubmission,
  MediaCursor,
  MediaFilters,
  MediaItem,
  MediaPage,
  MediaStats,
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

// Database errors become message keys (`errors.*`): the raw message never
// reaches the screen.
function fail(error: { message: string; code?: string } | null): never {
  const code = error?.code;
  if (isMfaError(error)) throw new AppError('mfaRequired', { cause: error });
  if (code === '42501' || code === 'PGRST301') throw new AppError('forbidden', { cause: error });
  if (code === '23505') throw new AppError('alreadyExists', { cause: error });
  if (code === '23514' || code === '22023') throw new AppError('invalidValues', { cause: error });
  throw new AppError('generic', { cause: error });
}

// ---------------------------------------------------------------- collections

export async function listCollection(
  db: SupabaseClient,
  def: CollectionDef,
  websiteId: string
): Promise<ContentRow[]> {
  let query = db.from(def.table).select('*').eq('website_id', websiteId);
  if (def.groupBy) query = query.order(def.groupBy, { ascending: true });
  const { data, error } = await query
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

/**
 * The collection's own columns from `values`, re-checked before writing (every
 * caller: the item form, the assistant's proposals): cleaned strings, no
 * HTML/script, https links, select values among the options.
 */
function pick(def: CollectionDef, values: Record<string, unknown>) {
  const row = sanitizeRow(def, values);
  if (!row) throw new AppError('invalidValues');
  return row;
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
  throw new AppError('generic');
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

/**
 * Saves a new display order: `ids` in their new order get sort_order 10, 20, …
 * Only rows whose position changed are written (each write pings the site).
 */
export async function reorderCollection(
  db: SupabaseClient,
  def: CollectionDef,
  rows: { id: string; sort_order: number }[]
) {
  const changed = rows
    .map((row, i) => ({ id: row.id, sort_order: (i + 1) * 10, before: row.sort_order }))
    .filter((row) => row.sort_order !== row.before);
  const results = await Promise.all(
    changed.map((row) => db.from(def.table).update({ sort_order: row.sort_order }).eq('id', row.id))
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) fail(failed.error);
}

export async function deleteCollectionItem(db: SupabaseClient, def: CollectionDef, id: string) {
  const { error, count } = await db.from(def.table).delete({ count: 'exact' }).eq('id', id);
  if (error) fail(error);
  if (!count) throw new AppError('forbidden');
}

// ---------------------------------------------------------------- inbox

export const PAGE_SIZE = 50;
export type AppointmentView = 'upcoming' | 'past' | 'all';

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

/** Private staff notes: cleaned and bounded (4000 characters), empty = null. */
function cleanNotes<T extends { staff_notes?: string | null }>(patch: T): T {
  if (typeof patch.staff_notes !== 'string') return patch;
  const notes = sanitizeNotes(patch.staff_notes);
  if (notes === undefined) throw new AppError('invalidValues');
  return { ...patch, staff_notes: notes };
}

/** Notes as stored: cleaned, null when empty, undefined when too long or holding HTML. */
export function sanitizeNotes(value: string): string | null | undefined {
  const notes = fields.text(4000, { multiline: true }).safeParse(value);
  return notes.success ? notes.data || null : undefined;
}

export async function updateAppointment(
  db: SupabaseClient,
  id: string,
  patch: { status?: AppointmentStatus; staff_notes?: string | null }
) {
  const { error } = await db.from('appointments').update(cleanNotes(patch)).eq('id', id);
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

export async function updateSubmission(
  db: SupabaseClient,
  id: string,
  patch: { status?: SubmissionStatus; staff_notes?: string | null }
) {
  const { error } = await db.from('form_submissions').update(cleanNotes(patch)).eq('id', id);
  if (error) fail(error);
}

// ---------------------------------------------------------------- media

const MEDIA_BUCKET = 'media';
/** Stored file limit (the `media` bucket's file_size_limit). */
export const MEDIA_MAX_BYTES = 10 * 1024 * 1024;
/** Picked image before optimization (resized and re-encoded in the browser). */
export const MEDIA_IMAGE_INPUT_MAX_BYTES = 30 * 1024 * 1024;
export const MEDIA_PAGE_SIZE = 48;
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
const MEDIA_COLUMNS =
  'id, storage_path, thumb_path, filename, mime_type, size_bytes, width, height, alt_text, created_at, created_by';

type MediaRow = Omit<MediaItem, 'url' | 'thumbUrl'>;

function withUrls(db: SupabaseClient, row: MediaRow): MediaItem {
  const bucket = db.storage.from(MEDIA_BUCKET);
  const url = bucket.getPublicUrl(row.storage_path).data.publicUrl;
  return {
    ...row,
    url,
    thumbUrl: row.thumb_path ? bucket.getPublicUrl(row.thumb_path).data.publicUrl : url
  };
}

/** One page of the library (newest first), from the media index: never lists the bucket. */
export async function listMedia(
  db: SupabaseClient,
  websiteId: string,
  filters: MediaFilters,
  cursor: MediaCursor | null
): Promise<MediaPage> {
  const page = await rpc<{ rows: MediaRow[]; next: MediaCursor | null }>(
    db.rpc('media_list', {
      p_website_id: websiteId,
      p_kind: filters.kind,
      p_search: filters.search,
      p_before_created_at: cursor?.created_at ?? null,
      p_before_id: cursor?.id ?? null,
      p_limit: MEDIA_PAGE_SIZE
    })
  );
  return { rows: page.rows.map((row) => withUrls(db, row)), next: page.next };
}

export async function getMediaStats(db: SupabaseClient, websiteId: string): Promise<MediaStats> {
  return rpc<MediaStats>(db.rpc('media_library_stats', { p_website_id: websiteId }));
}

/**
 * Uploads a file to org/<org>/site/<site>/<yyyy>/<mm>/<uuid>.<ext> with a one-year
 * cache, then registers it in the media index. Images are resized, converted to
 * WebP and stripped of their metadata in the browser first, with a WebP thumbnail.
 */
export async function uploadMedia(
  db: SupabaseClient,
  scope: SiteScope,
  file: File,
  altText?: string
): Promise<MediaItem> {
  if (!MEDIA_TYPES[file.type]) throw new AppError('mediaFormat');
  const isImage = file.type.startsWith('image/');
  if (file.size > (isImage ? MEDIA_IMAGE_INPUT_MAX_BYTES : MEDIA_MAX_BYTES)) {
    throw new AppError(isImage ? 'mediaImageTooLarge' : 'mediaTooLarge');
  }
  // The content must really be the declared format (a renamed HTML/SVG is refused).
  await assertFileSignature(file, Object.keys(MEDIA_TYPES), 'mediaFormat');

  let body: Blob = file;
  let type = file.type;
  let size: { width: number; height: number } | null = null;
  let thumb: Blob | null = null;
  if (isImage) {
    const optimized = await optimizeImage(file);
    body = optimized.blob;
    type = optimized.type;
    size = { width: optimized.width, height: optimized.height };
    thumb = optimized.thumb;
  }
  const ext = MEDIA_TYPES[type];
  if (!ext) throw new AppError('mediaFormat');
  if (body.size > MEDIA_MAX_BYTES) throw new AppError('mediaTooLarge');

  const {
    data: { user }
  } = await db.auth.getUser();
  if (!user) throw new AppError('sessionExpired');

  const bucket = db.storage.from(MEDIA_BUCKET);
  const path = mediaObjectPath(scope.organizationId, scope.websiteId, crypto.randomUUID(), ext);
  const upload = await bucket.upload(path, body, {
    contentType: type,
    cacheControl: MEDIA_CACHE_SECONDS,
    upsert: false
  });
  if (upload.error) throw new AppError('uploadForbidden', { cause: upload.error });

  let thumbPath: string | null = null;
  if (thumb) {
    const candidate = thumbPathFor(path);
    const thumbUpload = await bucket.upload(candidate, thumb, {
      contentType: 'image/webp',
      cacheControl: MEDIA_CACHE_SECONDS,
      upsert: false
    });
    // A missing thumbnail is not fatal: the grid shows the file itself.
    if (!thumbUpload.error) thumbPath = candidate;
  }

  const { data, error } = await db
    .from('media')
    .insert({
      organization_id: scope.organizationId,
      website_id: scope.websiteId,
      bucket: MEDIA_BUCKET,
      storage_path: path,
      thumb_path: thumbPath,
      filename: safeFileName(storedFileName(file.name, ext), `upload.${ext}`, 200),
      // Size and type are re-read from Storage by the database.
      mime_type: type,
      size_bytes: body.size,
      width: size?.width ?? null,
      height: size?.height ?? null,
      alt_text: cleanLine(altText ?? '').slice(0, 500) || null,
      created_by: user.id
    })
    .select(MEDIA_COLUMNS)
    .single();
  if (error) {
    await bucket.remove(thumbPath ? [path, thumbPath] : [path]);
    fail(error);
  }
  return withUrls(db, data as MediaRow);
}

export async function updateMediaAlt(db: SupabaseClient, id: string, altText: string) {
  const { error } = await db
    .from('media')
    .update({ alt_text: cleanLine(altText).slice(0, 500) || null })
    .eq('id', id);
  if (error) fail(error);
}

export async function deleteMedia(
  db: SupabaseClient,
  item: Pick<MediaItem, 'id' | 'storage_path' | 'thumb_path'>
) {
  const paths = item.thumb_path ? [item.storage_path, item.thumb_path] : [item.storage_path];
  const removed = await db.storage.from(MEDIA_BUCKET).remove(paths);
  if (removed.error) throw new AppError('deleteFailed', { cause: removed.error });
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

/**
 * Free-form JSON shown by the website: cleaned (hidden characters), bounded,
 * no prototype keys, and no script-capable HTML or javascript:/data: links.
 */
export function sanitizeContent(value: unknown): unknown {
  const clean = cleanJson(value, { maxString: 20000 });
  if (clean === null || findUnsafeJson(clean) !== null) throw new AppError('invalidValues');
  return clean;
}

export async function saveSetting(
  db: SupabaseClient,
  scope: SiteScope,
  key: string,
  rawValue: unknown
) {
  if (!/^[a-z0-9_]{1,64}$/.test(key)) throw new AppError('invalidValues');
  const value = sanitizeContent(rawValue);
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
  if (patch.data !== undefined) {
    const data = sanitizeContent(patch.data);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new AppError('invalidValues');
    }
    patch = { ...patch, data: data as Record<string, unknown> };
  }
  if (patch.status !== undefined && !['published', 'draft', 'archived'].includes(patch.status)) {
    throw new AppError('invalidValues');
  }
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
  // Exact origins only (https://host, no path); http only for local development.
  const origins = patch.allowedOrigins?.map((o) => cleanLine(o).replace(/\/$/, ''));
  if (origins && (origins.length > 50 || origins.some((o) => !isWebOrigin(o)))) {
    throw new AppError('invalidOrigin');
  }
  const domain = patch.primaryDomain === undefined ? undefined : cleanLine(patch.primaryDomain);
  if (domain && !PATTERNS.domain.test(domain)) throw new AppError('invalidDomain');
  if (patch.features?.some((f) => !/^[a-z0-9_]{1,64}$/.test(f))) {
    throw new AppError('invalidValues');
  }
  const { error } = await db.rpc('admin_update_website', {
    p_website_id: websiteId,
    p_allowed_origins: origins ?? null,
    p_features: patch.features ?? null,
    p_show_powered_by: patch.showPoweredBy ?? null,
    p_status: patch.status ?? null,
    p_primary_domain: domain ?? null
  });
  if (error) {
    if (error.code === '22023') throw new AppError('invalidOrigin', { cause: error });
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

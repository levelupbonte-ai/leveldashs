#!/usr/bin/env node
// Moves a website's media into the LevelUp Supabase Storage bucket "media".
//
// Two sources (combine them freely):
//   1. Remote images referenced in the database (gallery, team portfolios,
//      services, announcements, branding logo, content blocks) — downloaded,
//      uploaded, and every reference rewritten to the Storage URL.
//   2. A local folder (--dir) of self-hosted files (e.g. blackpater/public/media),
//      uploaded and registered in content block site/media { file: url }.
//
// Every file gets a `media` row (organization_id, website_id, storage_path…),
// so it shows up in the client dashboard. Files are stored under
// <organization_id>/<website_id>/<sha256>.<ext>; re-running is idempotent.
//
// Usage (server-side secret, never commit it):
//   SUPABASE_URL=https://xxx.supabase.co SUPABASE_SECRET_KEY=... \
//   node scripts/migrate-media.mjs --website ws_xxx [--dir ../site/public/media] [--dry-run]
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};
const DRY = args.includes('--dry-run');
const WEBSITE_ID = arg('--website');
const DIR = arg('--dir');
const URL_BASE = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SECRET_KEY;

if (!URL_BASE || !KEY || !/^ws_[a-z0-9]{8,32}$/.test(WEBSITE_ID ?? '')) {
  console.error('Usage: SUPABASE_URL=… SUPABASE_SECRET_KEY=… node scripts/migrate-media.mjs --website ws_xxx [--dir path] [--dry-run]');
  process.exit(1);
}

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.gif': 'image/gif', '.avif': 'image/avif', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.webm': 'video/webm'
};
const EXT = Object.fromEntries(Object.entries(MIME).map(([e, m]) => [m, e === '.jpeg' ? '.jpg' : e]));
const MAX_BYTES = 10 * 1024 * 1024;

async function rest(path, init = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    ...init,
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(init.headers ?? {}) }
  });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const [website] = await rest(`websites?id=eq.${WEBSITE_ID}&select=id,organization_id`);
if (!website) throw new Error(`Unknown website ${WEBSITE_ID}`);
const ORG = website.organization_id;
const publicUrl = (path) => `${URL_BASE}/storage/v1/object/public/media/${path}`;
const isStorageUrl = (u) => typeof u === 'string' && u.startsWith(`${URL_BASE}/storage/v1/object/public/media/`);

const uploaded = new Map(); // source key -> public URL

async function store(bytes, mime, filename, altText) {
  if (!MIME[EXT[mime] ?? ''] && !EXT[mime]) throw new Error(`Unsupported type ${mime} (${filename})`);
  if (bytes.length > MAX_BYTES) throw new Error(`${filename} is larger than 10 MB`);
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 24);
  const path = `${ORG}/${WEBSITE_ID}/${hash}${EXT[mime]}`;
  const url = publicUrl(path);
  if (DRY) return url;

  const up = await fetch(`${URL_BASE}/storage/v1/object/media/${path}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': mime, 'x-upsert': 'true', 'Cache-Control': 'public, max-age=31536000, immutable' },
    body: bytes
  });
  if (!up.ok) throw new Error(`upload ${filename} → ${up.status} ${await up.text()}`);

  await rest('media?on_conflict=bucket,storage_path', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({
      organization_id: ORG,
      website_id: WEBSITE_ID,
      bucket: 'media',
      storage_path: path,
      filename: filename.slice(0, 255),
      mime_type: mime,
      size_bytes: bytes.length,
      alt_text: altText ? String(altText).slice(0, 500) : null
    })
  });
  return url;
}

async function migrateRemote(url, altText) {
  if (!url || isStorageUrl(url) || !/^https:\/\//.test(url)) return url;
  if (uploaded.has(url)) return uploaded.get(url);
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`  ! skip ${url} (${res.status})`);
    return url;
  }
  const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim();
  if (!EXT[mime]) {
    console.warn(`  ! skip ${url} (type ${mime})`);
    return url;
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'image') || 'image';
  const stored = await store(bytes, mime, name, altText);
  uploaded.set(url, stored);
  console.log(`  ✓ ${url} → ${stored}`);
  return stored;
}

// Recursively rewrites every https image URL found under image-like keys.
async function rewriteJson(value, keyHint = '') {
  if (Array.isArray(value)) return Promise.all(value.map((v) => rewriteJson(v, keyHint)));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = await rewriteJson(v, k);
    return out;
  }
  if (typeof value === 'string' && /(image|logo|photo|picture|avatar|banner)/i.test(keyHint)) {
    return migrateRemote(value);
  }
  return value;
}

async function update(table, match, patch) {
  if (DRY) return;
  await rest(`${table}?${match}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
}

console.log(`Website ${WEBSITE_ID} (org ${ORG})${DRY ? ' — DRY RUN' : ''}`);

// 1. Remote references in the database
for (const table of ['gallery_items', 'services', 'announcements']) {
  const rows = await rest(`${table}?website_id=eq.${WEBSITE_ID}&select=id,image_url${table === 'gallery_items' ? ',title' : ''}`);
  for (const row of rows) {
    const next = await migrateRemote(row.image_url, row.title);
    if (next !== row.image_url) await update(table, `id=eq.${row.id}`, { image_url: next });
  }
}
for (const row of await rest(`team_members?website_id=eq.${WEBSITE_ID}&select=id,image_url,data`)) {
  const image_url = await migrateRemote(row.image_url);
  const data = await rewriteJson(row.data);
  if (image_url !== row.image_url || JSON.stringify(data) !== JSON.stringify(row.data)) {
    await update('team_members', `id=eq.${row.id}`, { image_url, data });
  }
}
for (const row of await rest(`content_blocks?website_id=eq.${WEBSITE_ID}&select=id,data`)) {
  const data = await rewriteJson(row.data);
  if (JSON.stringify(data) !== JSON.stringify(row.data)) await update('content_blocks', `id=eq.${row.id}`, { data });
}
for (const row of await rest(`website_settings?website_id=eq.${WEBSITE_ID}&key=eq.branding&select=key,value`)) {
  const value = await rewriteJson(row.value);
  if (JSON.stringify(value) !== JSON.stringify(row.value)) {
    await update('website_settings', `website_id=eq.${WEBSITE_ID}&key=eq.branding`, { value });
  }
}

// 2. Local folder → content block site/media
if (DIR) {
  const files = (await readdir(DIR)).filter((f) => MIME[extname(f).toLowerCase()]);
  const [block] = await rest(`content_blocks?website_id=eq.${WEBSITE_ID}&page=eq.site&block_key=eq.media&select=id,data`);
  const map = { ...(block?.data ?? {}) };
  for (const file of files) {
    const bytes = await readFile(join(DIR, file));
    const url = await store(bytes, MIME[extname(file).toLowerCase()], file);
    map[file] = url;
    console.log(`  ✓ ${file} → ${url}`);
  }
  if (!DRY) {
    if (block) {
      await update('content_blocks', `id=eq.${block.id}`, { data: map });
    } else {
      await rest('content_blocks', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ website_id: WEBSITE_ID, organization_id: ORG, page: 'site', block_key: 'media', data: map })
      });
    }
  }
}

console.log(`Done. ${uploaded.size} remote file(s)${DIR ? ' + local folder' : ''} processed.`);

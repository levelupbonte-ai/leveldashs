import type * as z from 'zod';

/**
 * Request guards for route handlers (see docs/security.md). Web-standard
 * `Request` / `Response` only, so the same code runs in Next.js and in tests.
 *
 *   const body = await readJsonBody(request, Body, { maxBytes: 8_000 });
 *   if (!body.ok) return body.response;
 *
 * - state-changing calls must come from this app (`Origin` = `Host`, or an
 *   allow-listed origin); `Sec-Fetch-Site: cross-site` is always refused;
 * - JSON only, body capped (Content-Length and the bytes actually read);
 * - the schema decides the rest: use `z.strictObject` so unknown keys are refused,
 *   and the `fields` builders so every string is cleaned and bounded;
 * - errors are short codes (`forbidden`, `too_large`, `invalid`, …), never the
 *   validation details.
 */

export type GuardResult<T> = { ok: true; data: T } | { ok: false; response: Response };

export const errorResponse = (status: number, error: string) =>
  Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });

/** True when the request was sent by a page of this app (or an allowed origin). */
export function isSameOrigin(request: Request, allowedOrigins: Iterable<string> = []): boolean {
  if (request.headers.get('sec-fetch-site') === 'cross-site') {
    // Browsers set it on every request; cross-site is never one of our pages.
    const origin = request.headers.get('origin');
    return !!origin && new Set(allowedOrigins).has(origin);
  }
  const origin = request.headers.get('origin');
  if (!origin || origin === 'null') return false;
  if (new Set(allowedOrigins).has(origin)) return true;
  try {
    return new URL(origin).host === request.headers.get('host');
  } catch {
    return false;
  }
}

/** Reads at most `maxBytes` of the body; null when it is larger or not UTF-8. */
async function readCapped(request: Request, maxBytes: number): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export interface JsonBodyOptions {
  /** Body size limit in bytes (default 16 KB). */
  maxBytes?: number;
  /** Skip the same-origin check (signed webhooks only). */
  allowCrossOrigin?: boolean;
  /** Extra origins allowed besides this app's own (exact `https://host`). */
  allowedOrigins?: Iterable<string>;
}

/**
 * Same-origin check, then the JSON body parsed by `schema`. A body-less call
 * (`{}` expected) can pass `z.strictObject({})`.
 */
export async function readJsonBody<S extends z.ZodType>(
  request: Request,
  schema: S,
  options: JsonBodyOptions = {}
): Promise<GuardResult<z.output<S>>> {
  const maxBytes = options.maxBytes ?? 16 * 1024;
  if (!options.allowCrossOrigin && !isSameOrigin(request, options.allowedOrigins)) {
    return { ok: false, response: errorResponse(403, 'forbidden') };
  }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) {
    return { ok: false, response: errorResponse(415, 'unsupported_media_type') };
  }
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (!Number.isFinite(declared) || declared > maxBytes) {
    return { ok: false, response: errorResponse(413, 'too_large') };
  }
  const text = await readCapped(request, maxBytes);
  if (text === null) return { ok: false, response: errorResponse(413, 'too_large') };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, response: errorResponse(400, 'invalid') };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return { ok: false, response: errorResponse(400, 'invalid') };
  return { ok: true, data: parsed.data };
}

/** Same-origin check for state-changing calls without a body. */
export function guardMutation(
  request: Request,
  allowedOrigins?: Iterable<string>
): Response | null {
  return isSameOrigin(request, allowedOrigins) ? null : errorResponse(403, 'forbidden');
}

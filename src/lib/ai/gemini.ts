import 'server-only';

import { GoogleGenAI } from '@google/genai';
import crypto from 'crypto';
// The dashboard never holds the Supabase secret key, so key health is not
// shared with the other apps from here: the pool keeps it in memory instead.
import type { SupabaseClient } from '@supabase/supabase-js';

const supabaseAdmin = (): SupabaseClient => {
  throw new Error('Shared key state is not used by the dashboard');
};

/**
 * Gemini key pool for the LevelUp Ecosystem.
 *
 * Keys: GEMINI_API_KEYS (comma/newline list or JSON array, shared by every
 * LevelUp app) and optionally GEMINI_KEYS_<POOL> to pin keys to one app.
 *
 * Pools: each app uses its own slice of the shared list so apps never drain
 * each other. GEMINI_POOL names this app's pool (default "studio") and
 * GEMINI_POOL_SPLIT the weights (default "studio:60,agents:25,site:15").
 * When every key of the pool is resting, keys of the other pools are borrowed
 * (set GEMINI_POOL_STRICT=1 to disable).
 *
 * Health is shared across all server instances through Supabase
 * (public.ai_key_state, service role only, SHA-256 fingerprints — never keys):
 *   - per-minute 429: the key rests for Google's retryDelay;
 *   - daily quota: the key rests until the next Pacific-time midnight reset;
 *   - invalid key: disabled for 24h;
 *   - 503 overload: short pause, next key.
 * A failed call is retried transparently with the next key, so a generation
 * is never returned half-done.
 */

export interface KeySlot {
  key: string;
  fingerprint: string;
  own: boolean;
  cooldownUntil: number;
  exhaustedUntil: number;
  invalidUntil: number;
  totalCalls: number;
  successCount: number;
  failureCount: number;
  consecutiveFailures: number;
  lastUsedAt: number;
}

export interface KeyRotationStats {
  pool: string;
  totalKeys: number;
  ownKeys: number;
  availableKeys: number;
  inCooldownKeys: number;
  exhaustedKeys: number;
  invalidKeys: number;
  keys: Array<{
    masked: string;
    own: boolean;
    inCooldown: boolean;
    exhausted: boolean;
    isInvalid: boolean;
    remainingCooldownMs: number;
    totalCalls: number;
    successCount: number;
    failureCount: number;
  }>;
}

type FailureKind = 'rate_limit' | 'daily_quota' | 'invalid_key' | 'overloaded' | 'other';

const DEFAULT_SPLIT = 'studio:60,agents:25,site:15';
const SHARED_STATE_TTL_MS = 10_000;
const MAX_WAIT_FOR_KEY_MS = 8_000;

function fingerprintOf(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

function parseKeyList(raw: string | undefined): string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.filter((k): k is string => typeof k === 'string');
    } catch {
      // fall through to delimited parsing
    }
  }
  return trimmed.split(/[\r\n,;\s]+/);
}

function isPlaceholderKey(k: string): boolean {
  const lower = k.trim().toLowerCase();
  return (
    lower.length < 30 ||
    /^(my_|your_|example_|test_|key_|<)/.test(lower) ||
    lower.endsWith('>') ||
    lower.includes('placeholder') ||
    lower.includes('dummy')
  );
}

/** Next 00:00 America/Los_Angeles, when Gemini daily quotas reset. */
function nextPacificMidnight(now = new Date()): number {
  const la = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const offset = now.getTime() - la.getTime();
  const next = new Date(la);
  next.setHours(24, 0, 0, 0);
  return next.getTime() + offset;
}

function classify(err: any): { kind: FailureKind; retryAfterMs?: number } {
  const msg = String(err?.message || err || '');
  const status = Number(err?.status || err?.code || 0);
  if (
    /API key not valid|API_KEY_INVALID|API key expired|UNAUTHENTICATED|ACCESS_TOKEN_TYPE_UNSUPPORTED|PERMISSION_DENIED/i.test(
      msg
    ) ||
    status === 401 ||
    status === 403
  ) {
    return { kind: 'invalid_key' };
  }
  if (status === 429 || /\b429\b|RESOURCE_EXHAUSTED|quota|Rate limit/i.test(msg)) {
    if (/PerDay|per[ _-]?day|daily/i.test(msg)) return { kind: 'daily_quota' };
    const delay =
      msg.match(/retryDelay"?\s*:\s*"?(\d+(?:\.\d+)?)s/i) ||
      msg.match(/retry in (\d+(?:\.\d+)?)\s*s/i);
    return {
      kind: 'rate_limit',
      retryAfterMs: delay ? Math.ceil(Number(delay[1]) * 1000) : undefined
    };
  }
  if (
    status === 503 ||
    status === 500 ||
    /\b50[03]\b|UNAVAILABLE|overloaded|high demand|INTERNAL/i.test(msg)
  ) {
    return { kind: 'overloaded' };
  }
  return { kind: 'other' };
}

export class AiCapacityError extends Error {
  constructor(message = 'All AI keys are resting. Please try again shortly.') {
    super(message);
    this.name = 'AiCapacityError';
  }
}

export class GeminiKeyRotator {
  private slots: KeySlot[] = [];
  private signature = '';
  private sharedLoadedAt = 0;
  private sharedLoading: Promise<void> | null = null;
  readonly pool: string;

  constructor(options?: { pool?: string }) {
    this.pool =
      (options?.pool || process.env.GEMINI_POOL || 'agents')
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '') || 'agents';
    this.refreshKeys();
  }

  /** Rebuilds the pool when the environment changes; keeps metrics for known keys. */
  public refreshKeys(): void {
    const pinned = parseKeyList(process.env[`GEMINI_KEYS_${this.pool.toUpperCase()}`]);
    const shared = [
      ...parseKeyList(process.env.GEMINI_API_KEYS),
      ...parseKeyList(process.env.GEMINI_API_KEY)
    ];
    const signature = `${pinned.join(',')}|${shared.join(',')}|${process.env.GEMINI_POOL_SPLIT || ''}|${process.env.GEMINI_POOL_STRICT || ''}`;
    if (signature === this.signature) return;
    this.signature = signature;

    const clean = (list: string[]) =>
      Array.from(new Set(list.map((k) => k.trim()).filter((k) => k && !isPlaceholderKey(k))));
    const pinnedKeys = clean(pinned);
    const sharedKeys = clean(shared).filter((k) => !pinnedKeys.includes(k));

    let own: string[];
    let overflow: string[];
    if (pinnedKeys.length) {
      own = pinnedKeys;
      overflow = sharedKeys;
    } else {
      // Same list everywhere → same deterministic slices in every app.
      const ordered = [...sharedKeys].sort((a, b) =>
        fingerprintOf(a).localeCompare(fingerprintOf(b))
      );
      const weights = (process.env.GEMINI_POOL_SPLIT || DEFAULT_SPLIT)
        .split(',')
        .map((p) => p.split(':'))
        .map(([name, w]) => ({
          name: (name || '').trim().toLowerCase(),
          weight: Math.max(0, Number(w) || 0)
        }))
        .filter((p) => p.name && p.weight > 0);
      const total = weights.reduce((a, p) => a + p.weight, 0);
      const mine = weights.findIndex((p) => p.name === this.pool);
      if (mine === -1 || total === 0 || ordered.length < weights.length) {
        own = ordered;
        overflow = [];
      } else {
        let start = 0;
        const ranges = weights.map((p, i) => {
          const end =
            i === weights.length - 1
              ? ordered.length
              : start + Math.max(1, Math.round((ordered.length * p.weight) / total));
          const r = [start, Math.min(end, ordered.length)] as const;
          start = r[1];
          return r;
        });
        own = ordered.slice(ranges[mine][0], ranges[mine][1]);
        overflow = ordered.filter((k) => !own.includes(k));
      }
    }
    if (process.env.GEMINI_POOL_STRICT === '1') overflow = [];

    const previous = new Map(this.slots.map((s) => [s.key, s]));
    const make = (key: string, isOwn: boolean): KeySlot => {
      const prev = previous.get(key);
      return prev
        ? { ...prev, own: isOwn }
        : {
            key,
            fingerprint: fingerprintOf(key),
            own: isOwn,
            cooldownUntil: 0,
            exhaustedUntil: 0,
            invalidUntil: 0,
            totalCalls: 0,
            successCount: 0,
            failureCount: 0,
            consecutiveFailures: 0,
            lastUsedAt: 0
          };
    };
    this.slots = [...own.map((k) => make(k, true)), ...overflow.map((k) => make(k, false))];
  }

  public getKeyCount(): number {
    this.refreshKeys();
    const now = Date.now();
    return this.slots.filter((s) => s.invalidUntil <= now).length;
  }

  private restingUntil(s: KeySlot): number {
    return Math.max(s.cooldownUntil, s.exhaustedUntil, s.invalidUntil);
  }

  // ------------------------------------------------------------ shared state

  private async loadSharedState(force = false): Promise<void> {
    if (!force && Date.now() - this.sharedLoadedAt < SHARED_STATE_TTL_MS) return;
    if (this.sharedLoading) return this.sharedLoading;
    this.sharedLoading = (async () => {
      try {
        const { data, error } = await supabaseAdmin()
          .from('ai_key_state')
          .select('fingerprint, cooldown_until, exhausted_until, invalid, updated_at')
          .eq('provider', 'gemini')
          .in(
            'fingerprint',
            this.slots.map((s) => s.fingerprint)
          );
        if (error) throw error;
        const byFp = new Map((data ?? []).map((r: any) => [r.fingerprint, r]));
        for (const s of this.slots) {
          const r: any = byFp.get(s.fingerprint);
          if (!r) continue;
          s.cooldownUntil = Math.max(
            s.cooldownUntil,
            r.cooldown_until ? Date.parse(r.cooldown_until) : 0
          );
          s.exhaustedUntil = Math.max(
            s.exhaustedUntil,
            r.exhausted_until ? Date.parse(r.exhausted_until) : 0
          );
          if (r.invalid)
            s.invalidUntil = Math.max(s.invalidUntil, Date.parse(r.updated_at) + 86_400_000);
        }
      } catch {
        // Shared state is an optimisation; local state keeps working without it.
      } finally {
        this.sharedLoadedAt = Date.now();
        this.sharedLoading = null;
      }
    })();
    return this.sharedLoading;
  }

  private report(
    s: KeySlot,
    success: boolean,
    extra?: { cooldownMs?: number; exhaustedUntil?: number; invalid?: boolean; error?: string }
  ) {
    try {
      void supabaseAdmin()
        .rpc('ai_key_report', {
          p_provider: 'gemini',
          p_fingerprint: s.fingerprint,
          p_pool: this.pool,
          p_success: success,
          p_cooldown_seconds: extra?.cooldownMs ? Math.ceil(extra.cooldownMs / 1000) : null,
          p_exhausted_until: extra?.exhaustedUntil
            ? new Date(extra.exhaustedUntil).toISOString()
            : null,
          p_invalid: extra?.invalid ?? false,
          p_error: extra?.error ? extra.error.slice(0, 300) : null
        })
        .then(
          () => undefined,
          () => undefined
        );
    } catch {
      // Supabase not configured: local state only.
    }
  }

  // ------------------------------------------------------------ selection

  private pick(exclude: Set<string>): KeySlot | null {
    const now = Date.now();
    const ready = (own: boolean) =>
      this.slots
        .filter((s) => s.own === own && !exclude.has(s.key) && this.restingUntil(s) <= now)
        // least recently used first spreads load evenly across keys
        .sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0];
    return ready(true) ?? ready(false) ?? null;
  }

  private markSuccess(s: KeySlot) {
    s.successCount++;
    s.consecutiveFailures = 0;
    const hadPenalty = s.cooldownUntil > 0 || s.exhaustedUntil > 0;
    s.cooldownUntil = 0;
    s.exhaustedUntil = 0;
    // Successes are reported sparingly to keep database writes low.
    if (hadPenalty || s.successCount % 25 === 1) this.report(s, true);
  }

  private markFailure(
    s: KeySlot,
    kind: FailureKind,
    retryAfterMs: number | undefined,
    message: string
  ) {
    s.failureCount++;
    s.consecutiveFailures++;
    const now = Date.now();
    if (kind === 'invalid_key') {
      s.invalidUntil = now + 86_400_000;
      this.report(s, false, { invalid: true, error: 'invalid key' });
      console.warn(
        `[gemini:${this.pool}] key ${s.fingerprint} rejected as invalid; disabled for 24h`
      );
    } else if (kind === 'daily_quota') {
      s.exhaustedUntil = nextPacificMidnight();
      this.report(s, false, { exhaustedUntil: s.exhaustedUntil, error: 'daily quota' });
    } else if (kind === 'rate_limit') {
      const backoff = Math.min(60_000 * Math.pow(1.5, s.consecutiveFailures - 1), 300_000);
      const ms = Math.max(retryAfterMs ?? 0, retryAfterMs ? 0 : backoff);
      s.cooldownUntil = now + ms;
      this.report(s, false, { cooldownMs: ms, error: 'rate limited' });
    } else {
      s.cooldownUntil = now + 5_000;
      if (s.consecutiveFailures >= 3)
        this.report(s, false, { cooldownMs: 5_000, error: message.slice(0, 120) });
    }
  }

  public createClient(apiKey: string): GoogleGenAI {
    return new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'levelup-ecosystem' } }
    });
  }

  /**
   * Runs `operation` with a healthy key. On a key-related failure the same
   * operation is retried with the next key, until it succeeds or every key is
   * resting. Errors unrelated to keys (bad request, safety block) are thrown
   * immediately.
   */
  public async executeWithRotation<T>(
    operation: (ai: GoogleGenAI, apiKey: string) => Promise<T>,
    maxRetries?: number
  ): Promise<T> {
    this.refreshKeys();
    if (this.slots.length === 0) {
      throw new Error('No Gemini API keys configured (GEMINI_API_KEYS).');
    }
    await this.loadSharedState();

    const tried = new Set<string>();
    const attempts = maxRetries ?? Math.min(this.slots.length, 12);
    let lastError: unknown = null;

    for (let i = 0; i < attempts; i++) {
      let slot = this.pick(tried);
      if (!slot) {
        // Everything is resting: wait for the soonest short cooldown, if any.
        const now = Date.now();
        const soonest = this.slots
          .filter((s) => !tried.has(s.key) || s.cooldownUntil > now)
          .map((s) => this.restingUntil(s))
          .filter((t) => t > now)
          .sort((a, b) => a - b)[0];
        if (soonest && soonest - now <= MAX_WAIT_FOR_KEY_MS) {
          await new Promise((r) => setTimeout(r, soonest - now + 50));
          await this.loadSharedState(true);
          tried.clear();
          slot = this.pick(tried);
        }
        if (!slot) break;
      }

      tried.add(slot.key);
      slot.totalCalls++;
      slot.lastUsedAt = Date.now();
      try {
        const result = await operation(this.createClient(slot.key), slot.key);
        this.markSuccess(slot);
        return result;
      } catch (err: any) {
        lastError = err;
        const { kind, retryAfterMs } = classify(err);
        if (kind === 'other') throw err;
        this.markFailure(slot, kind, retryAfterMs, String(err?.message || ''));
        console.warn(
          `[gemini:${this.pool}] attempt ${i + 1} failed (${kind}) with key ${slot.fingerprint}; switching key`
        );
      }
    }
    throw lastError && classify(lastError).kind === 'overloaded'
      ? lastError
      : new AiCapacityError();
  }

  /** Pool health for admins (fingerprints only, never keys). */
  public getStats(): KeyRotationStats {
    this.refreshKeys();
    const now = Date.now();
    return {
      pool: this.pool,
      totalKeys: this.slots.length,
      ownKeys: this.slots.filter((s) => s.own).length,
      availableKeys: this.slots.filter((s) => this.restingUntil(s) <= now).length,
      inCooldownKeys: this.slots.filter((s) => s.cooldownUntil > now).length,
      exhaustedKeys: this.slots.filter((s) => s.exhaustedUntil > now).length,
      invalidKeys: this.slots.filter((s) => s.invalidUntil > now).length,
      keys: this.slots.map((s) => ({
        masked: `fp:${s.fingerprint.slice(0, 8)}`,
        own: s.own,
        inCooldown: s.cooldownUntil > now,
        exhausted: s.exhaustedUntil > now,
        isInvalid: s.invalidUntil > now,
        remainingCooldownMs: Math.max(0, this.restingUntil(s) - now),
        totalCalls: s.totalCalls,
        successCount: s.successCount,
        failureCount: s.failureCount
      }))
    };
  }
}

export const geminiRotator = new GeminiKeyRotator();

import type { PortalThreadSummary } from '../api/types';

/** Reads the AI's JSON answer; null when it is not a usable summary. */
const URGENCY = ['low', 'normal', 'high'] as const;
const clip = (v: unknown, max: number) =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';

export function parseThreadSummary(text: string): PortalThreadSummary | null {
  const raw = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  for (const candidate of [raw, raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)]) {
    try {
      const v = JSON.parse(candidate) as Record<string, unknown>;
      const need = clip(v.need, 140);
      const summary = clip(v.summary, 600);
      if (!need || !summary) continue;
      const urgency = URGENCY.find((u) => u === v.urgency) ?? 'normal';
      return { need, summary, urgency, next: clip(v.next, 240) };
    } catch {
      // next candidate
    }
  }
  return null;
}

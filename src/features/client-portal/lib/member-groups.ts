import type { PortalInboxEntry } from '../api/types';

/** A set of members the team can pick at once (inbox, group message, publish). */
export interface MemberGroup {
  key: string;
  label: string;
  ids: string[];
}

/** Country name in the dashboard language ("US" → "États-Unis"). */
export function regionNamer(locale: string): (code: string) => string {
  try {
    const names = new Intl.DisplayNames([locale], { type: 'region' });
    return (code) => names.of(code) ?? code;
  } catch {
    return (code) => code;
  }
}

/**
 * Smart groups of active members: dossier to redo, each destination country
 * (largest first), and same country + same project when at least two share it.
 */
export function memberGroups(
  entries: Pick<PortalInboxEntry, 'id' | 'status' | 'has_dossier' | 'country' | 'purpose'>[],
  regionName: (code: string) => string,
  redoLabel: string
): MemberGroup[] {
  const byCountry = new Map<string, string[]>();
  const byProject = new Map<string, string[]>();
  const redo: string[] = [];
  for (const c of entries) {
    if (c.status !== 'active') continue;
    if (!c.has_dossier) redo.push(c.id);
    if (c.country) byCountry.set(c.country, [...(byCountry.get(c.country) ?? []), c.id]);
    if (c.country && c.purpose) {
      const key = `${c.country}|${c.purpose}`;
      byProject.set(key, [...(byProject.get(key) ?? []), c.id]);
    }
  }
  const out: MemberGroup[] = [];
  if (redo.length) out.push({ key: 'redo', label: redoLabel, ids: redo });
  for (const [code, ids] of [...byCountry].toSorted((a, b) => b[1].length - a[1].length)) {
    out.push({ key: `country:${code}`, label: regionName(code), ids });
  }
  for (const [key, ids] of byProject) {
    if (ids.length < 2) continue;
    const [code, purpose] = key.split('|');
    out.push({ key: `project:${key}`, label: `${regionName(code)} · ${purpose}`, ids });
  }
  return out;
}

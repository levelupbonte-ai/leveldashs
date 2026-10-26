/**
 * Matching hints for LevelUp staff reviewing an access request: which existing
 * websites answer on the host the applicant gave, which organizations have a
 * similar name. Same normalisation as the database (private.url_host).
 *
 * These are HINTS only. Nothing is ever granted because a domain or a name
 * matches: staff choose the website explicitly, and the website id alone is
 * public (it is in every client site's code).
 */

const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** Host of a URL or bare domain: lower case, no scheme, credentials, port, path, `www.` or trailing dot. */
export function normalizeHost(value: string | null | undefined): string | null {
  if (!value) return null;
  const host = value
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^[^/?#@\\]*@/, '')
    .replace(/[/?#\\].*$/, '')
    .replace(/:[0-9]*$/, '')
    .replace(/^www\.|\.$/g, '');
  return host.length >= 3 && host.length <= 253 && DOMAIN.test(host) ? host : null;
}

/** Domain of an e-mail address (`owner@www.Example.com` → `example.com`). */
export function emailDomain(email: string | null | undefined): string | null {
  if (!email || !email.includes('@')) return null;
  return normalizeHost(email.slice(email.lastIndexOf('@') + 1));
}

/** Every host a website answers on (primary domain + allowed origins), unique. */
export function websiteHosts(
  primaryDomain: string | null,
  allowedOrigins: string[] = []
): string[] {
  const hosts = [primaryDomain, ...allowedOrigins].map(normalizeHost).filter(Boolean) as string[];
  return [...new Set(hosts)];
}

/** Lower case, accents removed, letters and digits only ("Black_pater" → "blackpater"). */
export function normalizeName(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 0..1 similarity of two business names (1 = same once normalised). */
export function nameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (x.length < 2 || y.length < 2) return 0;
  if (x === y) return 1;
  if (x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x))) return 0.85;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

/** Names at least this similar are suggested. */
export const NAME_MATCH_THRESHOLD = 0.75;

export interface MatchCandidate {
  id: string;
  name: string;
  primaryDomain: string | null;
  hosts: string[];
  organizationName: string;
}

export interface SiteMatch<T extends MatchCandidate = MatchCandidate> {
  site: T;
  /** The website the applicant gave is one of this site's hosts. */
  hostMatch: boolean;
  /** The applicant's e-mail domain is one of this site's hosts. */
  emailMatch: boolean;
  /** Best similarity of the business name with the site or organization name. */
  nameScore: number;
}

/**
 * Websites worth suggesting for a request, best first: host match, then e-mail
 * domain, then name similarity. Sites with no hint at all are left out.
 */
export function suggestSites<T extends MatchCandidate>(
  request: { website: string | null; email: string | null; businessName: string },
  sites: T[]
): SiteMatch<T>[] {
  const host = normalizeHost(request.website);
  const mailDomain = emailDomain(request.email);
  return sites
    .map((site) => {
      const hosts = site.hosts.length ? site.hosts : websiteHosts(site.primaryDomain);
      return {
        site,
        hostMatch: !!host && hosts.includes(host),
        emailMatch: !!mailDomain && hosts.includes(mailDomain),
        nameScore: Math.max(
          nameSimilarity(request.businessName, site.organizationName),
          nameSimilarity(request.businessName, site.name),
          host ? nameSimilarity(host.split('.')[0], site.primaryDomain?.split('.')[0]) : 0
        )
      };
    })
    .filter((m) => m.hostMatch || m.emailMatch || m.nameScore >= NAME_MATCH_THRESHOLD)
    .toSorted(
      (a, b) =>
        Number(b.hostMatch) - Number(a.hostMatch) ||
        Number(b.emailMatch) - Number(a.emailMatch) ||
        b.nameScore - a.nameScore
    );
}

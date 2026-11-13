/**
 * Human demo (levelup-ecosystem.com "Start a project"): the client follows it on
 * the showcase's tracking page, opened with the tracking code and its token.
 */
export const SHOWCASE_URL = 'https://levelup-ecosystem.com';

export const DEMO_CODE = /^LU-[A-HJ-NP-Z2-9]{6}$/;
export const DEMO_TOKEN = /^[0-9a-f]{32}$/;

export function demoTrackingUrl(code: string, token: string, extra?: Record<string, string>) {
  const url = new URL(`/suivi/${encodeURIComponent(code)}`, SHOWCASE_URL);
  url.searchParams.set('k', token);
  for (const [k, v] of Object.entries(extra ?? {})) url.searchParams.set(k, v);
  return url.toString();
}

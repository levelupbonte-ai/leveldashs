/**
 * Stored LevelStudio HTML, made safe to show in the staff area. The iframe that
 * shows it is sandboxed with `allow-scripts` only (LevelStudio pages load the
 * Tailwind CDN script to style themselves) and never `allow-same-origin`: the page
 * runs in an opaque origin, without the dashboard's cookies, storage or DOM, and
 * cannot navigate the dashboard, open pop-ups or submit forms.
 *
 * On top of that, a Content-Security-Policy is put first in <head>: no network
 * calls (fetch, XHR, WebSocket, beacons), no form posts, no frames, no <base>;
 * scripts, styles, images and fonts may only come inline or over https.
 */
export const PREVIEW_SANDBOX = 'allow-scripts';

export const PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' https:",
  "style-src 'unsafe-inline' https:",
  'img-src https: data: blob:',
  'font-src https: data:',
  'media-src https:',
  "connect-src 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "base-uri 'none'"
].join('; ');

const META = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`;

/** The HTML with the preview policy first in its head (a head is added when missing). */
export function previewDocument(html: string): string {
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + META + html.slice(at);
  }
  const root = /<html(\s[^>]*)?>/i.exec(html);
  if (root) {
    const at = root.index + root[0].length;
    return `${html.slice(0, at)}<head>${META}</head>${html.slice(at)}`;
  }
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  const at = doctype ? doctype[0].length : 0;
  return `${html.slice(0, at)}<head>${META}</head>${html.slice(at)}`;
}

/** LevelStudio's public address of a share link (`/p/<token>`), or null. */
export function studioShareUrl(path: string | null): string | null {
  if (!path || !/^\/p\/[a-f0-9]{32}$/.test(path)) return null;
  return `https://studio.levelup-ecosystem.com${path}`;
}

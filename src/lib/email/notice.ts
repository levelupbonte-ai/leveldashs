import 'server-only';
import {
  cleanHeader,
  escapeHtml,
  isEmail,
  safeFileName,
  safeHttpUrl
} from '@/lib/validation/sanitize';

/**
 * Plain LevelUp notices (access requests and decisions), same look as the auth
 * e-mails, sent through Resend from the LevelUp domain. Every dynamic value is
 * escaped, the subject is one header-safe line, the recipient must be a valid
 * address and the button an https link. Never throws: returns whether Resend
 * accepted the e-mail.
 */

export const TEAM_INBOX = 'teams@levelup-ecosystem.com';
const FROM = process.env.AUTH_EMAIL_FROM || 'LevelUp Ecosystem <account@levelup-ecosystem.com>';

export interface NoticeInput {
  to: string;
  /** Language of the e-mail (`lang` attribute); the caller translates the text. */
  locale?: string;
  subject: string;
  title: string;
  lines: string[];
  /** Label / value rows shown in a small box (who invited you, role, …). */
  details?: { label: string; value: string }[];
  cta?: { label: string; url: string };
  /** Small print under the button (link expiry, "ignore this e-mail if…"). */
  footnote?: string;
  /** Files attached to the e-mail (e.g. a signed contract PDF). */
  attachments?: { filename: string; content: Uint8Array }[];
}

/** The HTML of a notice (every value escaped, https button only). */
export function renderNotice(input: Omit<NoticeInput, 'to' | 'attachments'>): string {
  const ctaUrl = input.cta ? safeHttpUrl(input.cta.url, { httpsOnly: true }) : null;
  const body = input.lines
    .map((l) => `<p style="font-size:15px;line-height:1.6;margin:0 0 10px">${escapeHtml(l)}</p>`)
    .join('');
  const details = input.details?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 4px;background:#f4f4f5;border-radius:12px;padding:12px 16px">${input.details
        .map(
          (d) =>
            `<tr><td style="font-size:13px;color:#71717a;padding:4px 12px 4px 0;white-space:nowrap;vertical-align:top">${escapeHtml(d.label)}</td><td style="font-size:14px;font-weight:600;padding:4px 0;word-break:break-word">${escapeHtml(d.value)}</td></tr>`
        )
        .join('')}</table>`
    : '';
  const button =
    input.cta && ctaUrl
      ? `<p style="margin:24px 0 0"><a href="${escapeHtml(ctaUrl)}" style="background:#0a0a0a;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;display:inline-block">${escapeHtml(input.cta.label)}</a></p>`
      : '';
  const footnote = input.footnote
    ? `<p style="font-size:12px;line-height:1.5;color:#71717a;margin:20px 0 0">${escapeHtml(input.footnote)}</p>`
    : '';
  return `<!doctype html><html lang="${input.locale === 'fr' ? 'fr' : 'en'}"><body style="margin:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0a0a0a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;padding:32px"><tr><td>
<p style="font-weight:800;font-size:18px;margin:0 0 24px"><img src="https://dashboard.levelup-ecosystem.com/apple-icon.png" width="32" height="32" alt="" style="vertical-align:middle;margin-right:8px;border-radius:8px">LevelUp<span style="color:#71717a;font-weight:600"> Ecosystem</span></p>
<h1 style="font-size:22px;margin:0 0 12px">${escapeHtml(input.title)}</h1>
${body}${details}${button}${footnote}
</td></tr></table>
<p style="color:#a1a1aa;font-size:12px;margin:16px 0 0">LevelUp Ecosystem · levelup-ecosystem.com</p>
</td></tr></table></body></html>`;
}

export async function sendNotice(input: NoticeInput): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn('sendNotice skipped: RESEND_API_KEY is not set');
    return false;
  }
  const to = input.to.trim().toLowerCase();
  if (!isEmail(to)) {
    console.warn('sendNotice skipped: invalid recipient');
    return false;
  }
  const html = renderNotice(input);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        subject: cleanHeader(input.subject),
        html,
        ...(input.attachments?.length
          ? {
              attachments: input.attachments.map((a) => ({
                filename: safeFileName(a.filename, 'attachment.pdf'),
                content: Buffer.from(a.content).toString('base64')
              }))
            }
          : {})
      }),
      signal: AbortSignal.timeout(input.attachments?.length ? 15000 : 8000)
    });
    // Status only: never the key, the recipient or Resend's message.
    if (!res.ok) console.warn('sendNotice: Resend refused the e-mail', res.status);
    return res.ok;
  } catch {
    console.warn('sendNotice: Resend unreachable');
    return false;
  }
}

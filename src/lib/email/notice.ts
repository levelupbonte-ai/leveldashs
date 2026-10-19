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

export async function sendNotice(input: {
  to: string;
  /** Language of the e-mail (`lang` attribute); the caller translates the text. */
  locale?: string;
  subject: string;
  title: string;
  lines: string[];
  cta?: { label: string; url: string };
  /** Files attached to the e-mail (e.g. a signed contract PDF). */
  attachments?: { filename: string; content: Uint8Array }[];
}): Promise<boolean> {
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
  const ctaUrl = input.cta ? safeHttpUrl(input.cta.url, { httpsOnly: true }) : null;
  const body = input.lines
    .map((l) => `<p style="font-size:15px;line-height:1.6;margin:0 0 10px">${escapeHtml(l)}</p>`)
    .join('');
  const button =
    input.cta && ctaUrl
      ? `<p style="margin:24px 0 0"><a href="${escapeHtml(ctaUrl)}" style="background:#0a0a0a;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;display:inline-block">${escapeHtml(input.cta.label)}</a></p>`
      : '';
  const html = `<!doctype html><html lang="${input.locale === 'fr' ? 'fr' : 'en'}"><body style="margin:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0a0a0a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;padding:32px"><tr><td>
<p style="font-weight:800;font-size:18px;margin:0 0 24px"><img src="https://dashboard.levelup-ecosystem.com/apple-icon.png" width="32" height="32" alt="" style="vertical-align:middle;margin-right:8px;border-radius:8px">LevelUp<span style="color:#71717a;font-weight:600"> Ecosystem</span></p>
<h1 style="font-size:22px;margin:0 0 12px">${escapeHtml(input.title)}</h1>
${body}${button}
</td></tr></table>
<p style="color:#a1a1aa;font-size:12px;margin:16px 0 0">LevelUp Ecosystem · levelup-ecosystem.com</p>
</td></tr></table></body></html>`;
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
    return res.ok;
  } catch {
    return false;
  }
}

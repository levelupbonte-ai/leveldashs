import 'server-only';

/**
 * Plain LevelUp notices (access requests and decisions), same look as the auth
 * e-mails, sent through Resend from the LevelUp domain. Every dynamic value is
 * escaped. Never throws: returns whether Resend accepted the e-mail.
 */

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );

export const TEAM_INBOX = 'teams@levelup-ecosystem.com';
const FROM = process.env.AUTH_EMAIL_FROM || 'LevelUp Ecosystem <account@levelup-ecosystem.com>';

export async function sendNotice(input: {
  to: string;
  subject: string;
  title: string;
  lines: string[];
  cta?: { label: string; url: string };
}): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const body = input.lines
    .map((l) => `<p style="font-size:15px;line-height:1.6;margin:0 0 10px">${escapeHtml(l)}</p>`)
    .join('');
  const button = input.cta
    ? `<p style="margin:24px 0 0"><a href="${escapeHtml(input.cta.url)}" style="background:#0a0a0a;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;display:inline-block">${escapeHtml(input.cta.label)}</a></p>`
    : '';
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0a0a0a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;padding:32px"><tr><td>
<p style="font-weight:800;font-size:18px;margin:0 0 24px">LevelUp<span style="color:#71717a;font-weight:600"> Ecosystem</span></p>
<h1 style="font-size:22px;margin:0 0 12px">${escapeHtml(input.title)}</h1>
${body}${button}
</td></tr></table>
<p style="color:#a1a1aa;font-size:12px;margin:16px 0 0">LevelUp Ecosystem · levelup-ecosystem.com</p>
</td></tr></table></body></html>`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [input.to], subject: input.subject, html }),
      signal: AbortSignal.timeout(8000)
    });
    return res.ok;
  } catch {
    return false;
  }
}

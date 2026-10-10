import 'server-only';
import { getTranslatorFor } from '@/i18n/messages';

/**
 * LevelUp-branded authentication e-mails (sign-up, magic link, password reset,
 * invitations, e-mail change). Sent by our own Resend domain through the
 * Supabase "Send Email Hook" (/api/auth/email-hook), never by Supabase defaults.
 */

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );

export type AuthEmail = { subject: string; html: string };

const TYPES = [
  'signup',
  'magiclink',
  'recovery',
  'invite',
  'email_change',
  'reauthentication',
  'password_changed_notification',
  'email_changed_notification'
] as const;
type AuthEmailType = (typeof TYPES)[number];
const WITH_CTA = new Set<AuthEmailType>([
  'signup',
  'magiclink',
  'recovery',
  'invite',
  'email_change'
]);

export function isSupportedAuthEmail(type: string): type is AuthEmailType {
  return (TYPES as readonly string[]).includes(type);
}

/**
 * Builds the e-mail in the recipient's language (`user_metadata.locale`, English
 * when unknown). Texts live in the `emails.auth` messages.
 */
export async function buildAuthEmail(
  type: string,
  opts: { link?: string; code?: string; locale?: unknown }
): Promise<AuthEmail> {
  const kind: AuthEmailType = isSupportedAuthEmail(type) ? type : 'magiclink';
  const { locale, t } = await getTranslatorFor(opts.locale);
  const c = {
    subject: escapeHtml(t(`emails.auth.${kind}.subject`)),
    title: escapeHtml(t(`emails.auth.${kind}.title`)),
    intro: escapeHtml(t(`emails.auth.${kind}.intro`)),
    outro: escapeHtml(t(`emails.auth.${kind}.outro`)),
    cta: WITH_CTA.has(kind)
      ? escapeHtml(t(`emails.auth.${kind}.cta` as 'emails.auth.signup.cta'))
      : ''
  };
  const button =
    c.cta && opts.link
      ? `<p style="margin:28px 0"><a href="${escapeHtml(opts.link)}" style="background:#0a0a0a;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;display:inline-block">${c.cta}</a></p>
<p style="color:#71717a;font-size:12px;line-height:1.5">${escapeHtml(t('emails.buttonFallback'))}<br><span style="word-break:break-all">${escapeHtml(opts.link)}</span></p>`
      : '';
  const code =
    opts.code && /^\d{6,10}$/.test(opts.code)
      ? `<p style="font-size:28px;letter-spacing:6px;font-weight:700;margin:24px 0">${opts.code}</p>`
      : '';
  const html = `<!doctype html><html lang="${locale}"><body style="margin:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0a0a0a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;padding:32px">
<tr><td>
<p style="font-weight:800;font-size:18px;margin:0 0 24px"><img src="https://dashboard.levelup-ecosystem.com/apple-icon.png" width="32" height="32" alt="" style="vertical-align:middle;margin-right:8px;border-radius:8px">LevelUp<span style="color:#71717a;font-weight:600"> Ecosystem</span></p>
<h1 style="font-size:22px;margin:0 0 12px">${c.title}</h1>
<p style="font-size:15px;line-height:1.6;margin:0">${c.intro}</p>
${button}${code}
<p style="font-size:13px;line-height:1.6;color:#52525b;margin:24px 0 0">${c.outro}</p>
</td></tr></table>
<p style="color:#a1a1aa;font-size:12px;margin:16px 0 0">LevelUp Ecosystem · levelup-ecosystem.com</p>
</td></tr></table></body></html>`;
  return { subject: t(`emails.auth.${kind}.subject`), html };
}

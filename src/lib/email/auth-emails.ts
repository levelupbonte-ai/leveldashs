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

type Content = {
  subject: string;
  title: string;
  intro: string;
  cta?: string;
  outro: string;
};

const CONTENT: Record<string, Content> = {
  signup: {
    subject: 'Confirmez votre compte LevelUp',
    title: 'Bienvenue chez LevelUp',
    intro: 'Confirmez votre adresse e-mail pour activer votre compte.',
    cta: 'Confirmer mon adresse',
    outro: 'Si vous n’avez pas créé de compte, ignorez simplement cet e-mail.'
  },
  magiclink: {
    subject: 'Votre lien de connexion LevelUp',
    title: 'Connexion à LevelUp',
    intro:
      'Cliquez sur le bouton ci-dessous pour vous connecter. Le lien est valable une seule fois.',
    cta: 'Me connecter',
    outro: 'Si vous n’avez pas demandé ce lien, ignorez cet e-mail : votre compte reste protégé.'
  },
  recovery: {
    subject: 'Réinitialisez votre mot de passe LevelUp',
    title: 'Nouveau mot de passe',
    intro: 'Vous avez demandé à changer votre mot de passe. Choisissez-en un nouveau ici :',
    cta: 'Choisir un nouveau mot de passe',
    outro: 'Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail : rien ne change.'
  },
  invite: {
    subject: 'Vous êtes invité sur LevelUp',
    title: 'Invitation LevelUp',
    intro:
      'Vous avez été invité à rejoindre un espace LevelUp. Acceptez l’invitation pour commencer.',
    cta: 'Accepter l’invitation',
    outro: 'Si vous ne vous attendiez pas à cette invitation, ignorez cet e-mail.'
  },
  email_change: {
    subject: 'Confirmez votre nouvelle adresse e-mail',
    title: 'Changement d’adresse e-mail',
    intro: 'Confirmez ce changement d’adresse e-mail pour votre compte LevelUp.',
    cta: 'Confirmer le changement',
    outro: 'Si vous n’êtes pas à l’origine de ce changement, contactez-nous immédiatement.'
  },
  reauthentication: {
    subject: 'Votre code de vérification LevelUp',
    title: 'Code de vérification',
    intro: 'Utilisez ce code pour confirmer votre action :',
    outro: 'Si vous n’avez rien demandé, changez votre mot de passe.'
  },
  password_changed_notification: {
    subject: 'Votre mot de passe LevelUp a été modifié',
    title: 'Mot de passe modifié',
    intro: 'Le mot de passe de votre compte LevelUp vient d’être changé.',
    outro:
      'Si ce n’était pas vous, réinitialisez votre mot de passe et contactez-nous immédiatement.'
  },
  email_changed_notification: {
    subject: 'L’adresse e-mail de votre compte LevelUp a changé',
    title: 'Adresse e-mail modifiée',
    intro: 'L’adresse e-mail associée à votre compte LevelUp a été modifiée.',
    outro: 'Si ce n’était pas vous, contactez-nous immédiatement.'
  }
};

export function isSupportedAuthEmail(type: string): boolean {
  return type in CONTENT;
}

export function buildAuthEmail(type: string, opts: { link?: string; code?: string }): AuthEmail {
  const c = CONTENT[type] ?? CONTENT.magiclink;
  const button =
    c.cta && opts.link
      ? `<p style="margin:28px 0"><a href="${escapeHtml(opts.link)}" style="background:#0a0a0a;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;display:inline-block">${c.cta}</a></p>
<p style="color:#71717a;font-size:12px;line-height:1.5">Le bouton ne fonctionne pas ? Copiez ce lien dans votre navigateur :<br><span style="word-break:break-all">${escapeHtml(opts.link)}</span></p>`
      : '';
  const code =
    opts.code && /^\d{6,10}$/.test(opts.code)
      ? `<p style="font-size:28px;letter-spacing:6px;font-weight:700;margin:24px 0">${opts.code}</p>`
      : '';
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0a0a0a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;padding:32px">
<tr><td>
<p style="font-weight:800;font-size:18px;margin:0 0 24px">LevelUp<span style="color:#71717a;font-weight:600"> Ecosystem</span></p>
<h1 style="font-size:22px;margin:0 0 12px">${c.title}</h1>
<p style="font-size:15px;line-height:1.6;margin:0">${c.intro}</p>
${button}${code}
<p style="font-size:13px;line-height:1.6;color:#52525b;margin:24px 0 0">${c.outro}</p>
</td></tr></table>
<p style="color:#a1a1aa;font-size:12px;margin:16px 0 0">LevelUp Ecosystem · levelup-ecosystem.com</p>
</td></tr></table></body></html>`;
  return { subject: c.subject, html };
}

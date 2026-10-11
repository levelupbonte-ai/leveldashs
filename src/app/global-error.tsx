'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect, useSyncExternalStore } from 'react';

// global-error replaces the root layout when it fails: no globals.css, no
// next-intl provider, no theme. Styles are inline and the few strings live here
// (exception to messages/*.json, which cannot be loaded at this point), picked
// from the NEXT_LOCALE cookie or the browser language.
const TEXT = {
  en: {
    eyebrow: 'Unexpected error',
    title: 'Something went wrong',
    description:
      'The dashboard could not load. Please try again; if it keeps happening, contact us and mention the reference below.',
    retry: 'Try again',
    home: 'Back to dashboard',
    reference: 'Reference',
    site: 'LevelUp Ecosystem',
    contact: 'Contact support'
  },
  fr: {
    eyebrow: 'Erreur inattendue',
    title: 'Une erreur est survenue',
    description:
      'Le tableau de bord n’a pas pu se charger. Réessayez ; si le problème persiste, contactez-nous en indiquant la référence ci-dessous.',
    retry: 'Réessayer',
    home: 'Retour au tableau de bord',
    reference: 'Référence',
    site: 'LevelUp Ecosystem',
    contact: 'Contacter le support'
  }
} as const;

type Lang = keyof typeof TEXT;

function detectLang(): Lang {
  const cookie = document.cookie.match(/(?:^|;\s*)NEXT_LOCALE=(en|fr)/)?.[1];
  if (cookie === 'en' || cookie === 'fr') return cookie;
  return navigator.language?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

const noSubscribe = () => () => {};

const CSS = `
  :root { color-scheme: light dark; --bg: #ffffff; --fg: #0a0a0a; --muted: #6b7280; --border: #e5e7eb; --primary: #4f46e5; --primary-fg: #ffffff; }
  @media (prefers-color-scheme: dark) { :root { --bg: #09090b; --fg: #fafafa; --muted: #a1a1aa; --border: #27272a; --primary: #818cf8; --primary-fg: #0a0a0a; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 64px 16px; background: var(--bg); color: var(--fg); font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif; }
  .wrap { width: 100%; max-width: 28rem; text-align: center; }
  .eyebrow { margin: 32px 0 0; color: var(--primary); font-size: 12px; font-weight: 600; letter-spacing: .2em; text-transform: uppercase; }
  .code { margin: 8px 0 0; font-size: 112px; line-height: 1; font-weight: 800; letter-spacing: -0.02em; background: linear-gradient(to bottom, var(--fg), transparent); -webkit-background-clip: text; background-clip: text; color: transparent; }
  h1 { margin: 16px 0 0; font-size: 26px; font-weight: 600; letter-spacing: -0.01em; }
  .desc { margin: 12px 0 0; color: var(--muted); font-size: 15px; line-height: 1.55; }
  .actions { margin-top: 32px; display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
  .btn { display: inline-flex; align-items: center; justify-content: center; height: 40px; padding: 0 20px; border-radius: 8px; font: inherit; font-size: 14px; font-weight: 500; cursor: pointer; text-decoration: none; border: 1px solid var(--border); background: transparent; color: var(--fg); }
  .btn.primary { background: var(--primary); border-color: var(--primary); color: var(--primary-fg); }
  .ref { margin-top: 24px; color: var(--muted); font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
  nav { margin-top: 48px; display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; font-size: 14px; }
  nav a { color: var(--muted); text-decoration: none; }
  nav a:hover { color: var(--fg); text-decoration: underline; }
`;

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // English on the server, the visitor's language once hydrated (no mismatch).
  const lang = useSyncExternalStore(noSubscribe, detectLang, () => 'en' as Lang);
  const t = TEXT[lang];

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang={lang}>
      <head>
        <title>{t.title}</title>
        <meta name='robots' content='noindex' />
        <style>{CSS}</style>
      </head>
      <body>
        <main className='wrap'>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src='/icon.svg' alt='' width={44} height={44} />
          <p className='eyebrow'>{t.eyebrow}</p>
          <p className='code' aria-hidden>
            500
          </p>
          <h1>{t.title}</h1>
          <p className='desc'>{t.description}</p>
          <div className='actions'>
            <button type='button' className='btn primary' onClick={() => reset()}>
              {t.retry}
            </button>
            {/* A full page load: the client router is what failed. */}
            {/* oxlint-disable-next-line nextjs/no-html-link-for-pages */}
            <a className='btn' href='/'>
              {t.home}
            </a>
          </div>
          {error.digest && (
            <p className='ref'>
              {t.reference}: {error.digest}
            </p>
          )}
          <nav>
            <a href='https://levelup-ecosystem.com'>{t.site}</a>
            <a href='mailto:contact@levelup-ecosystem.com'>{t.contact}</a>
          </nav>
        </main>
      </body>
    </html>
  );
}

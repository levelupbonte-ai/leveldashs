// Locales of the dashboard. English is the official language of the LevelUp
// ecosystem; French is a translation. No locale prefix in the URLs: the choice
// lives in the NEXT_LOCALE cookie (and in user_metadata.locale when signed in).
export const locales = ['en', 'fr'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'en';

/** Cookie read by `src/i18n/request.ts` (same name next-intl uses by default). */
export const LOCALE_COOKIE = 'NEXT_LOCALE';

export const localeCookieOptions = {
  path: '/',
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  maxAge: 60 * 60 * 24 * 365
};

/** Dates are shown in the clients' time zone (server and browser agree, no hydration drift). */
export const timeZone = 'America/Toronto';

export const localeNames: Record<Locale, string> = {
  en: 'English',
  fr: 'Français'
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value);
}

/** Best supported locale for an `Accept-Language` header, `defaultLocale` otherwise. */
export function matchAcceptLanguage(header: string | null | undefined): Locale {
  if (!header) return defaultLocale;
  const ranked = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.find((p) => p.trim().startsWith('q='));
      return { tag: tag.toLowerCase(), q: q ? Number(q.trim().slice(2)) || 0 : 1 };
    })
    .filter((entry) => entry.tag && entry.q > 0)
    .toSorted((a, b) => b.q - a.q);
  for (const { tag } of ranked) {
    const base = tag.split('-')[0];
    if (isLocale(base)) return base;
  }
  return defaultLocale;
}

/** The locale saved on a Supabase user (`user_metadata.locale`), if any. */
export function userLocale(user: { user_metadata?: unknown } | null | undefined): Locale | null {
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  return isLocale(meta.locale) ? meta.locale : null;
}

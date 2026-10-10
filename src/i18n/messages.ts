import { createTranslator } from 'next-intl';
import type en from '../../messages/en.json';
import { defaultLocale, isLocale, timeZone, type Locale } from './config';

export type Messages = typeof en;

export async function loadMessages(locale: Locale): Promise<Messages> {
  return (await import(`../../messages/${locale}.json`)).default as Messages;
}

/**
 * Translator usable outside of a request (route handlers, e-mails sent to someone
 * else than the visitor): pass the recipient's locale, English when unknown.
 */
export async function getTranslatorFor(locale: unknown) {
  const resolved: Locale = isLocale(locale) ? locale : defaultLocale;
  const messages = await loadMessages(resolved);
  return {
    locale: resolved,
    t: createTranslator({ locale: resolved, messages, timeZone })
  };
}

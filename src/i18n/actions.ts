'use server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { isLocale, LOCALE_COOKIE, localeCookieOptions } from './config';

/**
 * Saves the language chosen in the switcher: in the NEXT_LOCALE cookie (this
 * browser) and, when signed in, in `user_metadata.locale` (other devices and the
 * e-mails LevelUp sends to this person).
 */
export async function setLocale(locale: string): Promise<void> {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, localeCookieOptions);

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (user && user.user_metadata?.locale !== locale) {
    // Best effort: the cookie already applies the choice on this device.
    await supabase.auth.updateUser({ data: { locale } }).catch(() => undefined);
  }
}

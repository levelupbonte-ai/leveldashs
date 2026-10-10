import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';
import { isLocale, LOCALE_COOKIE, matchAcceptLanguage, timeZone } from './config';
import { loadMessages } from './messages';

// Locale of the request: NEXT_LOCALE cookie, then the browser's Accept-Language,
// then English. The proxy copies `user_metadata.locale` into the cookie for
// signed-in users who have none on this device.
export default getRequestConfig(async () => {
  const cookieValue = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(cookieValue)
    ? cookieValue
    : matchAcceptLanguage((await headers()).get('accept-language'));

  return {
    locale,
    timeZone,
    messages: await loadMessages(locale)
  };
});

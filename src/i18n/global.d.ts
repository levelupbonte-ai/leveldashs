import type messages from '../../messages/en.json';
import type { Locale } from './config';

// Typed keys: `t('auth.signIn.title')` fails `tsc` when the key is missing from en.json.
declare module 'next-intl' {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof messages;
  }
}

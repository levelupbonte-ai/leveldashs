import 'server-only';
import { PATTERNS } from '@/lib/validation/sanitize';

// Same-origin and body checks live in `@/lib/validation/http` (readJsonBody).

export const isUuid = (value: string) => PATTERNS.uuid.test(value);

export const DASHBOARD_URL = 'https://dashboard.levelup-ecosystem.com';
export const LEVELUP_CONTACT = 'contact@levelup-ecosystem.com';

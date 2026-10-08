/** Shown when a new password is on the list of widely used passwords. */
export const COMMON_PASSWORD_MESSAGE = 'Ce mot de passe est trop courant. Choisissez-en un autre.';

const RANGE_URL = 'https://api.pwnedpasswords.com/range/';
const TIMEOUT_MS = 3000;

async function sha1Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/**
 * True when the password appears in the public list of common passwords
 * (Have I Been Pwned range API, k-anonymity: only the first 5 characters of the
 * SHA-1 hash leave the browser, the comparison happens here). Any failure or a
 * response slower than 3 s returns false so nobody gets stuck (fail open).
 */
export async function isCommonPassword(password: string): Promise<boolean> {
  if (!password || typeof crypto === 'undefined' || !crypto.subtle) return false;
  try {
    const hash = await sha1Hex(password);
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);
    const res = await fetch(`${RANGE_URL}${prefix}`, {
      headers: { 'Add-Padding': 'true' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store'
    });
    if (!res.ok) return false;
    const body = await res.text();
    return body.split('\n').some((line) => {
      const [candidate, count] = line.trim().split(':');
      // Padding entries have a count of 0.
      return candidate === suffix && Number(count) > 0;
    });
  } catch {
    return false;
  }
}

/**
 * Form-level async `onSubmit` validator for TanStack Form: puts the message on
 * the `password` field when the password is too common.
 */
export async function commonPasswordValidator({ value }: { value: { password: string } }) {
  if (await isCommonPassword(value.password)) {
    return { fields: { password: { message: COMMON_PASSWORD_MESSAGE } } };
  }
  return undefined;
}

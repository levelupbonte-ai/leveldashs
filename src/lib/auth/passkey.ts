import { useSyncExternalStore } from 'react';

export type PasskeyErrorKind =
  | 'cancelled'
  | 'disabled'
  | 'not_found'
  | 'email_not_confirmed'
  | 'already_registered'
  | 'other';

/** Sorts a Supabase / WebAuthn passkey error into what the UI should do with it. */
export function passkeyErrorKind(error: unknown): PasskeyErrorKind {
  if (!error || typeof error !== 'object') return 'other';
  const e = error as { code?: unknown; name?: unknown; cause?: unknown };
  const code = typeof e.code === 'string' ? e.code : '';
  const causeName =
    e.cause && typeof e.cause === 'object' ? (e.cause as { name?: unknown }).name : undefined;
  const names = [e.name, causeName];
  // The person closed the browser prompt (or it timed out): nothing to report.
  if (
    code === 'ERROR_CEREMONY_ABORTED' ||
    names.includes('NotAllowedError') ||
    names.includes('AbortError')
  ) {
    return 'cancelled';
  }
  if (code === 'passkey_disabled') return 'disabled';
  if (code === 'webauthn_credential_not_found') return 'not_found';
  if (code === 'email_not_confirmed') return 'email_not_confirmed';
  if (code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') return 'already_registered';
  return 'other';
}

const noopSubscribe = () => () => {};

/** True in browsers that support WebAuthn (false during SSR). */
export function usePasskeySupport(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => typeof window.PublicKeyCredential !== 'undefined',
    () => false
  );
}

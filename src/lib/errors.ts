import type { Messages } from '@/i18n/messages';

/** Key of the `errors` messages: what the UI tells the user, never the raw cause. */
export type ErrorCode = keyof Messages['errors'];

/**
 * Error thrown by service layers. It carries a message key instead of text, so
 * components show a friendly, translated message (`useErrorMessage()`) and raw
 * database / provider errors never reach the screen.
 */
export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, options?: { cause?: unknown }) {
    super(code, options);
    this.name = 'AppError';
    this.code = code;
  }
}

export function errorCode(error: unknown, fallback: ErrorCode = 'generic'): ErrorCode {
  return error instanceof AppError ? error.code : fallback;
}

/** True when the database refused the call because the session is not aal2 yet. */
export function isMfaError(error: { message?: string } | null | undefined): boolean {
  return !!error?.message?.includes('aal2');
}

/** Only same-origin relative paths are allowed as post-login destinations. */
export function safeNext(next: string | null | undefined, fallback = '/dashboard/site'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return fallback;
  }
  return next;
}

'use client';
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { errorCode, type ErrorCode } from '@/lib/errors';

/** Translated, user-friendly text for an error thrown by a service (`AppError`). */
export function useErrorMessage() {
  const t = useTranslations('errors');
  return useCallback(
    (error: unknown, fallback: ErrorCode = 'generic') => t(errorCode(error, fallback)),
    [t]
  );
}

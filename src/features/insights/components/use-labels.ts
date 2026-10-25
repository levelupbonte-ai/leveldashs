'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { formTypeLabel } from '@/features/submissions/lib/fields';

const KNOWN_FORM_TYPES = [
  'contact',
  'quote',
  'vip_signup',
  'newsletter',
  'registration',
  'preview_request'
] as const;

/** Display name of a form type: translated when known, derived from the key otherwise. */
export function useFormTypeLabel() {
  const t = useTranslations('site.requests.types');
  return useCallback(
    (type: string) =>
      (KNOWN_FORM_TYPES as readonly string[]).includes(type)
        ? t(type as (typeof KNOWN_FORM_TYPES)[number])
        : formTypeLabel(type),
    [t]
  );
}

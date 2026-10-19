'use client';

import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { createFields, type FieldMessages } from './fields';

/** The translated `validation.*` messages of the field builders. */
export function useFieldMessages(): FieldMessages {
  const t = useTranslations('validation');
  return useMemo(
    () => ({
      required: t('required'),
      tooShort: (min) => t('minLength', { min }),
      tooLong: (max) => t('maxLength', { max }),
      tooMany: (max) => t('maxItems', { max }),
      noHtml: t('noHtml'),
      email: t('email'),
      url: t('url'),
      phone: t('phone'),
      slug: t('slug'),
      color: t('color'),
      date: t('date'),
      choice: t('choice'),
      invalid: t('invalid')
    }),
    [t]
  );
}

/** Field builders with the translated messages, for form schemas. */
export function useFields() {
  const messages = useFieldMessages();
  return useMemo(() => createFields(messages), [messages]);
}

'use client';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';
import type { CollectionDef, FieldDef } from '../config/collections';

type Key = Parameters<ReturnType<typeof useTranslations<'site'>>>[0];

const COMMON_FIELDS = new Set(['sort_order', 'status']);

/** Translated texts of a content collection (titles, field labels, hints, options). */
export function useCollectionText(def: CollectionDef) {
  const t = useTranslations('site');
  const base = `collections.${def.key}`;
  const tk = useCallback((key: string) => t(key as Key), [t]);

  return useMemo(
    () => ({
      title: tk(`${base}.title`),
      description: tk(`${base}.description`),
      addTitle: tk(`${base}.addTitle`),
      empty: tk(`${base}.empty`),
      fieldLabel: (f: FieldDef) =>
        COMMON_FIELDS.has(f.name) ? tk(`commonFields.${f.name}`) : tk(`${base}.fields.${f.name}`),
      fieldHint: (f: FieldDef) =>
        !f.hint
          ? undefined
          : COMMON_FIELDS.has(f.name)
            ? tk(`commonFields.${f.name}Hint`)
            : tk(`${base}.hints.${f.name}`),
      statusLabel: (value: string) =>
        ['published', 'draft', 'archived'].includes(value) ? tk(`status.${value}`) : value,
      options: (f: FieldDef) =>
        (f.options ?? []).map((o) => ({
          value: o.value,
          label:
            o.label ??
            (['published', 'draft', 'archived'].includes(o.value)
              ? tk(`status.${o.value}`)
              : o.value)
        }))
    }),
    [tk, base]
  );
}

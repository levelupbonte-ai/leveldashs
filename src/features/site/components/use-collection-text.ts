'use client';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';
import type { CollectionDef, FieldDef } from '../config/collections';

type Key = Parameters<ReturnType<typeof useTranslations<'site'>>>[0];

const COMMON_FIELDS = new Set(['sort_order', 'status']);
const STATUS_VALUES = new Set(['published', 'draft', 'archived', 'hidden']);

/** Translated texts of a content collection (titles, field labels, hints, options). */
export function useCollectionText(def: CollectionDef) {
  const t = useTranslations('site');
  const base = `collections.${def.key}`;
  const tk = useCallback((key: string) => t(key as Key), [t]);

  return useMemo(() => {
    const optionLabel = (f: FieldDef, value: string) => {
      const option = f.options?.find((o) => o.value === value);
      if (option?.label) return option.label;
      if (f.optionsKey) return tk(`fieldOptions.${f.optionsKey}.${value}`);
      return STATUS_VALUES.has(value) ? tk(`status.${value}`) : value;
    };
    const fieldLabel = (f: FieldDef) =>
      COMMON_FIELDS.has(f.name) ? tk(`commonFields.${f.name}`) : tk(`${base}.fields.${f.name}`);
    return {
      title: tk(`${base}.title`),
      description: tk(`${base}.description`),
      addTitle: tk(`${base}.addTitle`),
      empty: tk(`${base}.empty`),
      fieldLabel,
      fieldHint: (f: FieldDef) =>
        !f.hint
          ? undefined
          : COMMON_FIELDS.has(f.name) && !def.liveHint
            ? tk(`commonFields.${f.name}Hint`)
            : tk(`${base}.hints.${f.name}`),
      groupTitle: (group: string) => tk(`fieldGroups.${group}`),
      statusLabel: (value: string) => (STATUS_VALUES.has(value) ? tk(`status.${value}`) : value),
      options: (f: FieldDef) =>
        (f.options ?? []).map((o) => ({ value: o.value, label: optionLabel(f, o.value) })),
      /** A row value as shown on a card (select options translated). */
      display: (f: FieldDef | undefined, value: unknown) => {
        const raw = String(value ?? '');
        return f?.kind === 'select' && raw ? optionLabel(f, raw) : raw;
      },
      /** Badge text of a select / switch field, or null when nothing to show. */
      badge: (f: FieldDef, value: unknown) => {
        if (f.kind === 'switch') return value === true ? tk(`fieldBadges.${f.name}`) : null;
        if (f.kind === 'select' && typeof value === 'string' && value) return optionLabel(f, value);
        return null;
      }
    };
  }, [tk, base, def.liveHint]);
}

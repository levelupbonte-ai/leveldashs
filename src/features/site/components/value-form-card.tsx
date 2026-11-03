'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const LONG_TEXT = 120;
const MAX_DEPTH = 4;

/** "opening_hours" / "openingHours" -> "Opening hours". */
function humanize(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : key;
}

/**
 * A setting or a content block as a plain form (text fields, switches, lists),
 * never as raw code. The shape of the value decides the fields; known keys get
 * a translated label, others a readable one. Same props as the JSON editor it
 * replaces for clients (the raw view stays in the developer area).
 */
export function ValueFormCard({
  title,
  description,
  badge,
  value,
  disabled,
  saving,
  onSave
}: {
  title: string;
  description?: string;
  badge?: string;
  value: unknown;
  disabled?: boolean;
  saving?: boolean;
  onSave: (value: unknown) => void;
}) {
  const t = useTranslations('site.form');
  const initial = useMemo(() => JSON.stringify(value ?? null), [value]);
  const [draft, setDraft] = useState<Json>(() => (value ?? null) as Json);
  const dirty = JSON.stringify(draft) !== initial;
  const label = (key: string) => {
    const k = `keys.${key}` as 'keys.phone';
    return t.has(k) ? t(k) : humanize(key);
  };

  return (
    <Card>
      <CardHeader>
        <div className='flex items-center justify-between gap-2'>
          <CardTitle className='text-base'>{label(title)}</CardTitle>
          {badge && <Badge variant='outline'>{badge}</Badge>}
        </div>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className='grid gap-4'>
        <Field
          value={draft}
          onChange={setDraft}
          disabled={disabled}
          label={label}
          depth={0}
          t={t}
        />
        <div className='flex justify-end gap-2'>
          {dirty && (
            <Button
              type='button'
              variant='ghost'
              size='sm'
              disabled={saving}
              onClick={() => setDraft(JSON.parse(initial) as Json)}
            >
              {t('cancel')}
            </Button>
          )}
          <Button
            type='button'
            size='sm'
            disabled={disabled || saving || !dirty}
            onClick={() => onSave(draft)}
          >
            {t('save')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({
  value,
  onChange,
  disabled,
  label,
  depth,
  t,
  name
}: {
  value: Json;
  onChange: (next: Json) => void;
  disabled?: boolean;
  label: (key: string) => string;
  depth: number;
  t: ReturnType<typeof useTranslations<'site.form'>>;
  name?: string;
}) {
  if (typeof value === 'boolean') {
    return (
      <label className='flex items-center justify-between gap-3 text-sm'>
        <span>{name ?? t('enabled')}</span>
        <Switch checked={value} disabled={disabled} onCheckedChange={(v) => onChange(v === true)} />
      </label>
    );
  }
  if (typeof value === 'number') {
    return (
      <Input
        type='number'
        value={Number.isFinite(value) ? value : 0}
        disabled={disabled}
        aria-label={name}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
      />
    );
  }
  if (value === null || typeof value === 'string') {
    const text = value ?? '';
    return text.length > LONG_TEXT || text.includes('\n') ? (
      <Textarea
        value={text}
        rows={4}
        maxLength={5000}
        disabled={disabled}
        aria-label={name}
        onChange={(e) => onChange(e.target.value)}
      />
    ) : (
      <Input
        value={text}
        maxLength={1000}
        disabled={disabled}
        aria-label={name}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (Array.isArray(value)) {
    const simple = value.every((v) => typeof v === 'string' || typeof v === 'number');
    if (simple) {
      // One item per line: the friendliest way to edit a list of words or links.
      return (
        <div className='grid gap-1'>
          <Textarea
            value={value.join('\n')}
            rows={Math.min(8, Math.max(2, value.length + 1))}
            disabled={disabled}
            aria-label={name}
            onChange={(e) =>
              onChange(
                e.target.value
                  .split('\n')
                  .map((v) => v.trimEnd())
                  .filter((v, i, all) => v !== '' || i < all.length - 1)
              )
            }
          />
          <p className='text-muted-foreground text-xs'>{t('onePerLine')}</p>
        </div>
      );
    }
    return (
      <div className='grid gap-3'>
        {value.map((item, i) => (
          <div key={i} className='bg-muted/30 grid gap-3 rounded-lg border p-3'>
            <div className='flex items-center justify-between'>
              <span className='text-muted-foreground text-xs'>{t('item', { n: i + 1 })}</span>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                disabled={disabled}
                aria-label={t('remove')}
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              >
                <Icons.trash className='size-4' />
              </Button>
            </div>
            <Field
              value={item}
              onChange={(next) => onChange(value.map((v, j) => (j === i ? next : v)))}
              disabled={disabled}
              label={label}
              depth={depth + 1}
              t={t}
            />
          </div>
        ))}
        {value.length > 0 && (
          <Button
            type='button'
            variant='outline'
            size='sm'
            disabled={disabled}
            onClick={() => onChange([...value, emptyLike(value[value.length - 1])])}
          >
            <Icons.add className='mr-1 size-4' /> {t('add')}
          </Button>
        )}
      </div>
    );
  }
  // Object: one labelled field per key (nested objects become sections).
  const entries = Object.entries(value);
  if (depth >= MAX_DEPTH) {
    return <p className='text-muted-foreground text-xs'>{t('tooDeep')}</p>;
  }
  return (
    <div className={depth > 0 ? 'grid gap-3 border-l pl-3' : 'grid gap-3'}>
      {entries.map(([key, v]) =>
        typeof v === 'boolean' ? (
          <Field
            key={key}
            name={label(key)}
            value={v}
            onChange={(next) => onChange({ ...value, [key]: next })}
            disabled={disabled}
            label={label}
            depth={depth + 1}
            t={t}
          />
        ) : (
          <div key={key} className='grid gap-1.5'>
            <span className='text-sm font-medium'>{label(key)}</span>
            <Field
              name={label(key)}
              value={v}
              onChange={(next) => onChange({ ...value, [key]: next })}
              disabled={disabled}
              label={label}
              depth={depth + 1}
              t={t}
            />
          </div>
        )
      )}
      {entries.length === 0 && <p className='text-muted-foreground text-xs'>{t('empty')}</p>}
    </div>
  );
}

/** A blank item shaped like an existing one (same keys, empty values). */
function emptyLike(sample: Json): Json {
  if (typeof sample === 'string') return '';
  if (typeof sample === 'number') return 0;
  if (typeof sample === 'boolean') return false;
  if (sample === null) return null;
  if (Array.isArray(sample)) return [];
  return Object.fromEntries(Object.entries(sample).map(([k, v]) => [k, emptyLike(v)]));
}

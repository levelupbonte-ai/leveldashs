'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';
import { CharCounter } from '@/components/forms/char-counter';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Icons } from '@/components/icons';
import { useFieldContext, useFieldInvalid, type BaseFieldProps } from '@/lib/form-context';

/**
 * Free-text tag list over a `string[]` value. Use with `mode='array'` on the
 * `<form.AppField>` — Enter or the Add button pushes, badges remove.
 * `maxLength` caps each tag, `maxItems` the list (with a "3 / 12" counter).
 */
export function TagsField({
  label,
  description,
  required,
  placeholder,
  maxLength,
  maxItems
}: BaseFieldProps & { placeholder?: string; maxLength?: number; maxItems?: number }) {
  const t = useTranslations('forms');
  placeholder ??= t('tagsPlaceholder');
  const field = useFieldContext<string[]>();
  const isInvalid = useFieldInvalid();
  const [tagInput, setTagInput] = React.useState('');
  const values = field.state.value || [];
  const full = maxItems !== undefined && values.length >= maxItems;
  const counterId = `${field.name}-count`;
  const describedBy =
    [isInvalid && `${field.name}-error`, maxItems && counterId].filter(Boolean).join(' ') ||
    undefined;

  const addTag = () => {
    const tag = tagInput.trim();
    if (tag && !full && !values.includes(tag)) {
      field.pushValue(tag);
      setTagInput('');
    }
  };

  return (
    <Field data-invalid={isInvalid}>
      <FieldLabel>
        {label}
        {required && ' *'}
      </FieldLabel>
      <div className='flex gap-2'>
        <Input
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addTag();
            }
          }}
          placeholder={placeholder}
          aria-label={t('addTag', { label: label.replace(/ \*$/, '') })}
          aria-invalid={isInvalid}
          aria-describedby={describedBy}
          maxLength={maxLength}
          disabled={full}
        />
        <Button type='button' variant='secondary' onClick={addTag} disabled={full}>
          {t('add')}
        </Button>
      </div>
      {values.length > 0 && (
        <div className='flex flex-wrap gap-2'>
          {values.map((tag, idx) => (
            <Badge key={tag} variant='secondary' className='gap-1'>
              {tag}
              <button
                type='button'
                onClick={() => field.removeValue(idx)}
                aria-label={t('removeTag', { tag })}
                className='hover:text-destructive ml-0.5'
              >
                <Icons.close className='h-3 w-3' />
              </button>
            </Badge>
          ))}
        </div>
      )}
      {maxItems ? (
        <div className='flex items-start gap-3'>
          {description && <FieldDescription className='min-w-0'>{description}</FieldDescription>}
          <CharCounter id={counterId} count={values.length} max={maxItems} unit='items' />
        </div>
      ) : (
        description && <FieldDescription>{description}</FieldDescription>
      )}
      {isInvalid && <FieldError id={`${field.name}-error`} errors={field.state.meta.errors} />}
    </Field>
  );
}

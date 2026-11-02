'use client';

import * as React from 'react';
import { CharCounter } from '@/components/forms/char-counter';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { isCountedType } from '@/lib/char-count';
import { useFieldContext, useFieldInvalid, type BaseFieldProps } from '@/lib/form-context';

/**
 * Text-style input (text, email, password, tel, url, time, number).
 * For `type='number'` the value converts at the edge: clearing writes
 * `undefined` so a required `z.number({ error: '…' })` reports a human
 * message instead of a type error.
 *
 * With `maxLength`, text-like inputs show a character counter ("42 / 160");
 * `showCount={false}` hides it (codes, currencies).
 */
export function TextField({
  label,
  description,
  required,
  showCount = true,
  ...inputProps
}: BaseFieldProps & {
  /** Show the character counter when `maxLength` is set (default true). */
  showCount?: boolean;
} & Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange' | 'onBlur'>) {
  const field = useFieldContext<string | number | undefined>();
  const isInvalid = useFieldInvalid();
  const isValidating = field.state.meta.isValidating;
  const max = inputProps.maxLength;
  const counted = showCount && !!max && isCountedType(inputProps.type);
  const counterId = `${field.name}-count`;
  const describedBy =
    [isInvalid && `${field.name}-error`, counted && counterId].filter(Boolean).join(' ') ||
    undefined;

  return (
    <Field data-invalid={isInvalid}>
      <FieldLabel htmlFor={field.name}>
        {label}
        {required && ' *'}
      </FieldLabel>
      <div className='relative'>
        <Input
          id={field.name}
          name={field.name}
          value={field.state.value ?? ''}
          onBlur={field.handleBlur}
          onChange={(e) =>
            field.handleChange(
              inputProps.type === 'number'
                ? e.target.value === ''
                  ? undefined
                  : Number(e.target.value)
                : e.target.value
            )
          }
          aria-invalid={isInvalid}
          aria-describedby={describedBy}
          {...inputProps}
        />
        {isValidating && <Spinner className='absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2' />}
      </div>
      {counted ? (
        <div className='flex items-start gap-3'>
          {description && <FieldDescription className='min-w-0'>{description}</FieldDescription>}
          <CharCounter id={counterId} count={String(field.state.value ?? '').length} max={max} />
        </div>
      ) : (
        description && <FieldDescription>{description}</FieldDescription>
      )}
      {isInvalid && <FieldError id={`${field.name}-error`} errors={field.state.meta.errors} />}
    </Field>
  );
}

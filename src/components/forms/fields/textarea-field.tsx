'use client';

import * as React from 'react';
import { CharCounter } from '@/components/forms/char-counter';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { useFieldContext, useFieldInvalid, type BaseFieldProps } from '@/lib/form-context';

/** Multi-line text. With `maxLength`, shows a character counter ("42 / 160"). */
export function TextareaField({
  label,
  description,
  required,
  showCount = true,
  ...textareaProps
}: BaseFieldProps & {
  /** Show the character counter when `maxLength` is set (default true). */
  showCount?: boolean;
} & Omit<React.ComponentProps<typeof Textarea>, 'value' | 'onChange' | 'onBlur'>) {
  const field = useFieldContext<string>();
  const isInvalid = useFieldInvalid();
  const max = textareaProps.maxLength;
  const counted = showCount && !!max;
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
      <Textarea
        id={field.name}
        name={field.name}
        value={field.state.value ?? ''}
        onBlur={field.handleBlur}
        onChange={(e) => field.handleChange(e.target.value)}
        aria-invalid={isInvalid}
        aria-describedby={describedBy}
        {...textareaProps}
      />
      {counted ? (
        <div className='flex items-start gap-3'>
          {description && <FieldDescription className='min-w-0'>{description}</FieldDescription>}
          <CharCounter id={counterId} count={(field.state.value ?? '').length} max={max} />
        </div>
      ) : (
        description && <FieldDescription>{description}</FieldDescription>
      )}
      {isInvalid && <FieldError id={`${field.name}-error`} errors={field.state.meta.errors} />}
    </Field>
  );
}

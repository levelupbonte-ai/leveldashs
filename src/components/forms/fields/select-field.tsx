'use client';

import { useTranslations } from 'next-intl';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { useFieldContext, useFieldInvalid, type BaseFieldProps } from '@/lib/form-context';

export function SelectField({
  label,
  description,
  required,
  placeholder,
  options
}: BaseFieldProps & {
  placeholder?: string;
  options: { value: string; label: string; disabled?: boolean }[];
}) {
  const t = useTranslations('forms');
  placeholder ??= t('select');
  const field = useFieldContext<string>();
  const isInvalid = useFieldInvalid();

  return (
    <Field data-invalid={isInvalid}>
      <FieldLabel htmlFor={field.name}>
        {label}
        {required && ' *'}
      </FieldLabel>
      <Select
        name={field.name}
        value={field.state.value}
        onValueChange={(value) => field.handleChange(value ?? '')}
      >
        <SelectTrigger
          id={field.name}
          aria-invalid={isInvalid}
          aria-describedby={isInvalid ? `${field.name}-error` : undefined}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} disabled={opt.disabled}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {description && <FieldDescription>{description}</FieldDescription>}
      {isInvalid && <FieldError id={`${field.name}-error`} errors={field.state.meta.errors} />}
    </Field>
  );
}

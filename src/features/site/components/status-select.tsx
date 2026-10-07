'use client';

import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';

export function StatusSelect<T extends string>({
  value,
  options,
  onChange,
  disabled,
  label
}: {
  value: T;
  options: Record<T, string>;
  onChange: (value: T) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <NativeSelect
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as T)}
      className='h-8 min-w-36 text-xs'
    >
      {(Object.keys(options) as T[]).map((k) => (
        <NativeSelectOption key={k} value={k}>
          {options[k]}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

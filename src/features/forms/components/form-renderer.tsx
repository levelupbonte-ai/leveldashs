'use client';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import type { FormField, FormSettings, FormValues, PublicForm } from '../api/types';
import { validateValues, type FieldError } from '../lib/fields';

/** Error key of the consent box (never a field id: those start with a letter). */
const CONSENT = '_consent';

const RADIUS = { none: 'rounded-none', md: 'rounded-md', lg: 'rounded-xl' } as const;

/** The look of a LevelUp form: forced light / dark (or the viewer's theme) and the client's accent. */
export function formTheme(settings: FormSettings) {
  const dark = settings.mode === 'dark';
  const light = settings.mode === 'light';
  return {
    accent: settings.accent ?? '#111827',
    radius: RADIUS[settings.radius ?? 'md'],
    page: dark
      ? 'bg-zinc-950 text-zinc-50'
      : light
        ? 'bg-zinc-50 text-zinc-900'
        : 'bg-muted/40 text-foreground',
    card: dark
      ? 'bg-zinc-900 border-zinc-800'
      : light
        ? 'bg-white border-zinc-200'
        : 'bg-background border-border',
    input: dark
      ? 'bg-zinc-950 border-zinc-700 text-zinc-50 placeholder:text-zinc-500'
      : light
        ? 'bg-white border-zinc-300 text-zinc-900 placeholder:text-zinc-400'
        : 'bg-background border-input placeholder:text-muted-foreground',
    muted: dark ? 'text-zinc-400' : light ? 'text-zinc-500' : 'text-muted-foreground'
  };
}

type Theme = ReturnType<typeof formTheme>;

function Field({
  field,
  value,
  error,
  onChange,
  theme,
  disabled
}: {
  field: FormField;
  value: FormValues[string];
  error?: FieldError;
  onChange: (v: FormValues[string]) => void;
  theme: Theme;
  disabled?: boolean;
}) {
  const t = useTranslations('siteForms.public');
  const id = `lu-f-${field.id}`;
  const describedBy = [field.help ? `${id}-help` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ');
  const base = cn(
    'w-full border px-3 py-2.5 text-base outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--lu-accent)] sm:text-sm',
    theme.input,
    theme.radius,
    error && 'border-red-500'
  );
  const common = {
    id,
    disabled,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy || undefined,
    'aria-required': field.required || undefined
  };
  const label = (
    <label htmlFor={id} className='text-sm font-medium'>
      {field.label}
      {field.required && (
        <span className='text-red-500' aria-hidden>
          {' '}
          *
        </span>
      )}
    </label>
  );

  let control: React.ReactNode;
  switch (field.type) {
    case 'textarea':
      control = (
        <textarea
          {...common}
          rows={4}
          maxLength={5000}
          placeholder={field.placeholder}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className={cn(base, 'min-h-28 resize-y')}
        />
      );
      break;
    case 'select':
      control = (
        <select
          {...common}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className={cn(base, 'h-11 sm:h-10')}
        >
          <option value=''>{field.placeholder || t('choose')}</option>
          {field.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
      break;
    case 'radio':
    case 'multiselect': {
      const multi = field.type === 'multiselect';
      const selected = multi ? ((value as string[]) ?? []) : [(value as string) ?? ''];
      return (
        <fieldset className='grid gap-2' aria-describedby={describedBy || undefined}>
          <legend className='mb-1 text-sm font-medium'>
            {field.label}
            {field.required && (
              <span className='text-red-500' aria-hidden>
                {' '}
                *
              </span>
            )}
          </legend>
          <div className='grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2'>
            {field.options?.map((o) => {
              const on = selected.includes(o);
              return (
                <label
                  key={o}
                  className={cn(
                    'flex min-h-11 cursor-pointer items-center gap-2.5 border px-3 py-2 text-sm transition',
                    theme.input,
                    theme.radius,
                    on && 'border-[var(--lu-accent)] ring-1 ring-[var(--lu-accent)]'
                  )}
                >
                  <input
                    type={multi ? 'checkbox' : 'radio'}
                    name={id}
                    disabled={disabled}
                    checked={on}
                    onChange={() =>
                      onChange(
                        multi ? (on ? selected.filter((s) => s !== o) : [...selected, o]) : o
                      )
                    }
                    className='size-4 accent-[var(--lu-accent)]'
                  />
                  {o}
                </label>
              );
            })}
          </div>
          {field.help && (
            <p id={`${id}-help`} className={cn('text-xs', theme.muted)}>
              {field.help}
            </p>
          )}
          {error && (
            <p id={`${id}-error`} className='text-xs text-red-500'>
              {t(`errors.${error}`)}
            </p>
          )}
        </fieldset>
      );
    }
    case 'checkbox':
      return (
        <div className='grid gap-1'>
          <label className='flex min-h-11 cursor-pointer items-start gap-2.5 py-1 text-sm'>
            <input
              {...common}
              type='checkbox'
              checked={value === true}
              onChange={(e) => onChange(e.target.checked)}
              className='mt-0.5 size-4 accent-[var(--lu-accent)]'
            />
            <span>
              {field.label}
              {field.required && (
                <span className='text-red-500' aria-hidden>
                  {' '}
                  *
                </span>
              )}
            </span>
          </label>
          {error && (
            <p id={`${id}-error`} className='text-xs text-red-500'>
              {t(`errors.${error}`)}
            </p>
          )}
        </div>
      );
    default:
      control = (
        <input
          {...common}
          type={
            field.type === 'email'
              ? 'email'
              : field.type === 'phone'
                ? 'tel'
                : field.type === 'date'
                  ? 'date'
                  : field.type === 'number'
                    ? 'number'
                    : 'text'
          }
          inputMode={field.type === 'number' ? 'decimal' : undefined}
          autoComplete={
            field.maps === 'name'
              ? 'name'
              : field.maps === 'email'
                ? 'email'
                : field.maps === 'phone'
                  ? 'tel'
                  : field.maps === 'company'
                    ? 'organization'
                    : undefined
          }
          maxLength={field.type === 'email' ? 254 : 200}
          placeholder={field.placeholder}
          value={(value as string | number | undefined) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className={cn(base, 'h-11 sm:h-10')}
        />
      );
  }

  return (
    <div className='grid gap-1.5'>
      {label}
      {control}
      {field.help && (
        <p id={`${id}-help`} className={cn('text-xs', theme.muted)}>
          {field.help}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className='text-xs text-red-500'>
          {t(`errors.${error}`)}
        </p>
      )}
    </div>
  );
}

export type SubmitResult =
  | { ok: true; ticket?: string }
  | { ok: false; field?: string; error: 'invalid' | 'limit' | 'unavailable' | 'captcha' };

/**
 * A LevelUp form, exactly as visitors see it (hosted page, and the live preview
 * in the dashboard builder). Values are checked here first, then again by the
 * database.
 */
export function FormRenderer({
  form,
  onSubmit,
  preview,
  footer,
  beforeSubmit
}: {
  form: Pick<PublicForm, 'fields' | 'settings' | 'site' | 'name'>;
  onSubmit?: (values: FormValues, consent: boolean) => Promise<SubmitResult>;
  preview?: boolean;
  /** Extra content above the button (e.g. the anti-robot check). */
  beforeSubmit?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const t = useTranslations('siteForms.public');
  const { settings, fields, site } = form;
  const theme = formTheme(settings);
  const [values, setValues] = useState<FormValues>({});
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, FieldError>>({});
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [failure, setFailure] = useState<string | null>(null);
  const [ticket, setTicket] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (preview || !onSubmit || status === 'sending') return;
    const found = validateValues(fields, values);
    if (settings.consent_text && !consent) found[CONSENT] = 'required';
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length) {
      const first = Object.keys(found)[0];
      document.getElementById(first === CONSENT ? CONSENT : `lu-f-${first}`)?.focus();
      return;
    }
    setStatus('sending');
    const result = await onSubmit(values, consent);
    if (result.ok) {
      setTicket(result.ticket ?? null);
      setStatus('sent');
      if (settings.redirect_url) window.location.assign(settings.redirect_url);
      return;
    }
    setStatus('idle');
    if (result.field) setErrors({ [result.field]: 'required' });
    setFailure(t(`failure.${result.error}`));
  }

  const style = { '--lu-accent': theme.accent } as React.CSSProperties;

  return (
    <div
      style={style}
      className={cn('w-full border p-5 shadow-sm sm:p-8', theme.card, theme.radius)}
    >
      {(settings.show_logo !== false && site.logo_url) || site.name ? (
        <div className='mb-5 flex items-center gap-3'>
          {settings.show_logo !== false && site.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element -- client logo from their settings
            <img src={site.logo_url} alt='' className='size-10 rounded-md object-contain' />
          )}
          {site.name && <span className={cn('text-sm font-medium', theme.muted)}>{site.name}</span>}
        </div>
      ) : null}

      {status === 'sent' ? (
        <div className='py-6 text-center' role='status'>
          <span
            className='mx-auto flex size-12 items-center justify-center rounded-full text-white'
            style={{ background: theme.accent }}
          >
            <Icons.check className='size-6' aria-hidden />
          </span>
          <h2 className='mt-4 text-xl font-semibold'>
            {settings.success_title || t('successTitle')}
          </h2>
          <p className={cn('mt-2 text-sm whitespace-pre-wrap', theme.muted)}>
            {settings.success_message || t('successMessage')}
          </p>
          {ticket && (
            <p className={cn('mt-3 text-xs', theme.muted)}>{t('reference', { ticket })}</p>
          )}
        </div>
      ) : (
        <form noValidate onSubmit={submit} className='grid gap-5'>
          <div>
            <h1 className='text-2xl font-semibold tracking-tight'>{settings.title || form.name}</h1>
            {settings.description && (
              <p className={cn('mt-2 text-sm whitespace-pre-wrap', theme.muted)}>
                {settings.description}
              </p>
            )}
          </div>
          <div className='grid gap-4 sm:grid-cols-2'>
            {fields.map((f) => (
              <div key={f.id} className={f.width === 'half' ? '' : 'sm:col-span-2'}>
                <Field
                  field={f}
                  theme={theme}
                  value={values[f.id]}
                  error={errors[f.id]}
                  disabled={status === 'sending'}
                  onChange={(v) => {
                    setValues((all) => ({ ...all, [f.id]: v }));
                    if (errors[f.id]) setErrors(({ [f.id]: _, ...rest }) => rest);
                  }}
                />
              </div>
            ))}
          </div>
          {settings.consent_text && (
            <label className='flex cursor-pointer items-start gap-2.5 text-sm'>
              <input
                id={CONSENT}
                type='checkbox'
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                aria-invalid={errors[CONSENT] ? true : undefined}
                className='mt-0.5 size-4 accent-[var(--lu-accent)]'
              />
              <span className={errors[CONSENT] ? 'text-red-500' : theme.muted}>
                {settings.consent_text}
              </span>
            </label>
          )}
          {beforeSubmit}
          {failure && (
            <p role='alert' className='rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600'>
              {failure}
            </p>
          )}
          <button
            type='submit'
            disabled={status === 'sending'}
            className={cn(
              'flex h-12 w-full items-center justify-center gap-2 px-5 text-base font-medium text-white transition hover:opacity-90 disabled:opacity-60 sm:h-11 sm:text-sm',
              theme.radius
            )}
            style={{ background: theme.accent }}
          >
            {status === 'sending' && <Icons.spinner className='size-4 animate-spin' aria-hidden />}
            {settings.submit_label || t('submit')}
          </button>
        </form>
      )}
      {footer}
    </div>
  );
}

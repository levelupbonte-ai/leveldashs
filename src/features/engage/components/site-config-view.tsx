'use client';

import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';
import { Icons } from '@/components/icons';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';
import { FieldGroup } from '@/components/ui/field';
import { useErrorMessage } from '@/hooks/use-error-message';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import { useFields } from '@/lib/validation/use-fields';
import { useSiteScope } from '@/features/site/components/use-site-scope';
import { configValuesQueryOptions, engageKeys } from '../api/queries';
import { deleteConfigValue, setConfigValue } from '../api/service';
import { CONFIG_KINDS, type ConfigKind, type ConfigValue } from '../api/types';
import { fromLocalInput, toLocalInput } from './dates';

/**
 * Values the website reads without a code change (a promo end date, a price
 * shown, a switch): LevelUp.config('key') in the page, or the site bundle on
 * a server. Public by design: never a password or a key.
 */
export function SiteConfigView() {
  const scope = useSiteScope();
  const t = useTranslations('engage.config');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const { data } = useSuspenseQuery(configValuesQueryOptions(createClient(), scope.websiteId));
  const [editing, setEditing] = useState<ConfigValue | null | undefined>(undefined);

  const remove = useMutation({
    mutationFn: (key: string) => deleteConfigValue(createClient(), scope.websiteId, key),
    onSuccess: () => {
      toast.success(t('deleted'));
      void queryClient.invalidateQueries({ queryKey: engageKeys.config(scope.websiteId) });
    },
    onError: (error) => toast.error(errorMessage(error))
  });

  const show = (v: ConfigValue) => {
    if (v.kind === 'date' && typeof v.value === 'string') {
      return format.dateTime(new Date(v.value), { dateStyle: 'medium', timeStyle: 'short' });
    }
    if (v.kind === 'boolean') return v.value ? t('yes') : t('no');
    const s = typeof v.value === 'string' ? v.value : JSON.stringify(v.value);
    return s.length > 120 ? `${s.slice(0, 120)}…` : s;
  };

  return (
    <div className='space-y-4'>
      <Alert>
        <Icons.lock aria-hidden />
        <AlertDescription>{t('publicWarning')}</AlertDescription>
      </Alert>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <p className='text-muted-foreground max-w-2xl text-sm'>{t('intro')}</p>
        {scope.canEdit && (
          <Button onClick={() => setEditing(null)}>
            <Icons.add aria-hidden />
            {t('new')}
          </Button>
        )}
      </div>
      {data.length === 0 ? (
        <Empty className='border'>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <Icons.adjustments />
            </EmptyMedia>
            <EmptyTitle>{t('emptyTitle')}</EmptyTitle>
            <EmptyDescription>{t('emptyDescription')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className='space-y-2'>
          {data.map((v) => (
            <li key={v.key}>
              <Card className='py-3'>
                <CardContent className='flex flex-col gap-2 px-4 sm:flex-row sm:items-center'>
                  <div className='min-w-0 flex-1'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <code className='font-mono text-sm font-semibold'>{v.key}</code>
                      <Badge variant='outline'>{t(`kinds.${v.kind}`)}</Badge>
                    </div>
                    <p className='mt-1 truncate text-sm'>{show(v)}</p>
                    {v.description && (
                      <p className='text-muted-foreground text-xs'>{v.description}</p>
                    )}
                  </div>
                  {scope.canEdit && (
                    <div className='flex gap-2'>
                      <Button size='sm' variant='outline' onClick={() => setEditing(v)}>
                        <Icons.edit aria-hidden />
                        {t('edit')}
                      </Button>
                      <Button
                        size='sm'
                        variant='ghost'
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(v.key)}
                        aria-label={t('delete', { key: v.key })}
                      >
                        <Icons.trash aria-hidden />
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Card className='py-4'>
        <CardContent className='space-y-2 px-4 text-sm'>
          <p className='font-medium'>{t('how.title')}</p>
          <p className='text-muted-foreground'>{t('how.text')}</p>
          <code className='bg-muted block overflow-x-auto rounded-md px-3 py-2 text-xs'>
            {"const endsAt = await LevelUp.config('launch.ends_at');"}
          </code>
        </CardContent>
      </Card>
      <Dialog open={editing !== undefined} onOpenChange={(open) => !open && setEditing(undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? t('editTitle') : t('newTitle')}</DialogTitle>
            <DialogDescription>{t('dialogDescription')}</DialogDescription>
          </DialogHeader>
          {editing !== undefined && (
            <ConfigForm value={editing} onDone={() => setEditing(undefined)} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function initialText(v: ConfigValue | null) {
  if (!v) return '';
  if (v.kind === 'date' && typeof v.value === 'string') return toLocalInput(v.value);
  if (v.kind === 'json') return JSON.stringify(v.value, null, 2);
  if (v.kind === 'boolean') return v.value ? 'true' : 'false';
  return String(v.value ?? '');
}

/** The typed value of the form's text, or not ok. */
function parse(kind: ConfigKind, raw: string): { ok: true; value: unknown } | { ok: false } {
  const s = raw.trim();
  if (kind === 'text') return { ok: true, value: raw };
  if (kind === 'number')
    return s !== '' && Number.isFinite(Number(s)) ? { ok: true, value: Number(s) } : { ok: false };
  if (kind === 'boolean') return { ok: true, value: s === 'true' };
  if (kind === 'date') {
    const iso = fromLocalInput(s);
    return iso ? { ok: true, value: iso } : { ok: false };
  }
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? { ok: true, value: v } : { ok: false };
  } catch {
    return { ok: false };
  }
}

function ConfigForm({ value, onDone }: { value: ConfigValue | null; onDone: () => void }) {
  const scope = useSiteScope();
  const t = useTranslations('engage.config');
  const f = useFields();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();

  const schema = useMemo(
    () =>
      z
        .object({
          key: z.string().regex(/^[a-z][a-z0-9_.]{0,63}$/, t('keyInvalid')),
          kind: z.enum(CONFIG_KINDS),
          raw: z.string().max(4000),
          description: f.text(200)
        })
        .superRefine((v, ctx) => {
          if (!parse(v.kind, v.raw).ok)
            ctx.addIssue({ code: 'custom', path: ['raw'], message: t('valueInvalid') });
        }),
    [f, t]
  );

  const form = useAppForm({
    defaultValues: {
      key: value?.key ?? '',
      kind: (value?.kind ?? 'text') as ConfigKind,
      raw: initialText(value),
      description: value?.description ?? ''
    },
    validators: { onSubmit: schema },
    onSubmit: async ({ value: v }) => {
      const parsed = schema.parse(v);
      const out = parse(parsed.kind, parsed.raw);
      if (!out.ok) return;
      try {
        await setConfigValue(createClient(), scope.websiteId, {
          key: parsed.key,
          kind: parsed.kind,
          value: out.value,
          description: parsed.description
        });
        toast.success(t('saved'));
        void queryClient.invalidateQueries({ queryKey: engageKeys.config(scope.websiteId) });
        onDone();
      } catch (error) {
        toast.error(errorMessage(error));
      }
    }
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
      className='space-y-4'
    >
      <FieldGroup>
        <form.AppField
          name='key'
          children={(field) => (
            <field.TextField
              label={t('key')}
              description={t('keyHint')}
              placeholder='launch.ends_at'
              disabled={!!value}
              maxLength={64}
              showCount={false}
              required
            />
          )}
        />
        <form.AppField
          name='kind'
          children={(field) => (
            <field.SelectField
              label={t('kind')}
              options={CONFIG_KINDS.map((k) => ({ value: k, label: t(`kinds.${k}`) }))}
            />
          )}
        />
        <form.Subscribe selector={(s) => s.values.kind}>
          {(kind) => (
            <form.AppField
              name='raw'
              children={(field) =>
                kind === 'date' ? (
                  <field.TextField label={t('value')} type='datetime-local' />
                ) : kind === 'boolean' ? (
                  <field.SelectField
                    label={t('value')}
                    options={[
                      { value: 'true', label: t('yes') },
                      { value: 'false', label: t('no') }
                    ]}
                  />
                ) : kind === 'json' || kind === 'text' ? (
                  <field.TextareaField
                    label={t('value')}
                    description={kind === 'json' ? t('jsonHint') : undefined}
                    rows={kind === 'json' ? 6 : 3}
                  />
                ) : (
                  <field.TextField label={t('value')} inputMode='decimal' showCount={false} />
                )
              }
            />
          )}
        </form.Subscribe>
        <form.AppField
          name='description'
          children={(field) => <field.TextField label={t('descriptionLabel')} maxLength={200} />}
        />
      </FieldGroup>
      <DialogFooter>
        <Button type='button' variant='outline' onClick={onDone}>
          {t('cancel')}
        </Button>
        <form.AppForm>
          <form.SubmitButton>{t('save')}</form.SubmitButton>
        </form.AppForm>
      </DialogFooter>
    </form>
  );
}

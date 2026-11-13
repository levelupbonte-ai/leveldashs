'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';
import { Badge } from '@/components/ui/badge';
import { LoadingButton } from '@/components/ui/loading-button';
import { useErrorMessage } from '@/hooks/use-error-message';
import { useAppForm } from '@/lib/form';
import { useSiteScope } from '@/features/site/components/use-site-scope';
import { projectRequestKeys } from '../api/queries';
import { updateProjectDemo } from '../api/service';
import { DEMO_STEPS, type DemoStep, type ProjectRequest } from '../api/types';

const money = (
  format: ReturnType<typeof useFormatter>,
  amount: number | null,
  currency: string | null
) =>
  amount === null || !currency
    ? ''
    : format.number(amount / 100, { style: 'currency', currency: currency.toUpperCase() });

const day = (date: string) => new Date(`${date}T12:00:00Z`);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The paid human demo of a request: what was paid, the AI estimate, and the
 * step the client sees on their tracking page. Owners / admins move it along,
 * with a message, the demo link and the planned date; the client is e-mailed.
 */
export function DemoPanel({ request: r, canEdit }: { request: ProjectRequest; canEdit: boolean }) {
  const demo = r.demo;
  const scope = useSiteScope();
  const t = useTranslations('insights.projectRequests.demo');
  const tv = useTranslations('validation');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();

  const schema = useMemo(
    () =>
      z
        .object({
          status: z.enum(DEMO_STEPS),
          message: z
            .string()
            .trim()
            .max(600, { message: tv('maxLength', { max: 600 }) }),
          demoUrl: z
            .string()
            .trim()
            .max(500, { message: tv('maxLength', { max: 500 }) })
            .refine((v) => !v || /^https:\/\/\S+$/.test(v), { message: tv('url') }),
          readyBy: z.date().or(z.undefined()),
          notify: z.boolean()
        })
        .refine((v) => v.status !== 'ready' || !!v.demoUrl, {
          path: ['demoUrl'],
          message: t('urlHint')
        }),
    [t, tv]
  );

  const save = useMutation({
    mutationFn: (v: z.infer<typeof schema>) =>
      updateProjectDemo({
        websiteId: scope.websiteId,
        id: r.id,
        status: v.status,
        message: v.message || undefined,
        demoUrl: v.demoUrl || undefined,
        readyBy: v.readyBy ? isoDay(v.readyBy) : undefined,
        notify: v.notify
      }),
    onSuccess: (out) => {
      toast.success(out.emailed ? t('savedEmailed') : t('saved'));
      void queryClient.invalidateQueries({ queryKey: projectRequestKeys.all(scope.websiteId) });
    },
    onError: (e) => toast.error(errorMessage(e, 'saveFailed'))
  });

  const current: DemoStep = demo && demo.status !== 'awaiting_payment' ? demo.status : 'paid';
  const form = useAppForm({
    defaultValues: {
      status: current as DemoStep,
      message: '',
      demoUrl: demo?.url ?? '',
      readyBy: demo?.ready_by ? day(demo.ready_by) : undefined,
      notify: true
    },
    validators: { onSubmit: schema },
    onSubmit: async ({ value, formApi }) => {
      await save.mutateAsync(schema.parse(value));
      formApi.setFieldValue('message', '');
    }
  });

  if (!demo) return null;
  const paid = !!demo.paid_at;
  const steps = DEMO_STEPS.map((s) => ({ value: s, label: t(`statuses.${s}`) }));

  return (
    <section className='space-y-3 rounded-md border p-3'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h3 className='text-sm font-medium'>{t('title')}</h3>
        <Badge variant={paid ? 'default' : 'secondary'}>{t(`statuses.${demo.status}`)}</Badge>
      </div>
      <p className='text-sm'>
        {paid
          ? t('paid', {
              amount: money(format, demo.amount, demo.currency),
              date: format.dateTime(new Date(demo.paid_at!), { dateStyle: 'medium' })
            })
          : t('awaiting', { amount: money(format, demo.amount, demo.currency) })}
      </p>
      <dl className='grid grid-cols-[minmax(0,9rem)_1fr] gap-x-4 gap-y-1 text-sm'>
        {demo.code && (
          <>
            <dt className='text-muted-foreground'>{t('code')}</dt>
            <dd className='font-mono'>{demo.code}</dd>
          </>
        )}
        {demo.ready_by && (
          <>
            <dt className='text-muted-foreground'>{t('readyBy')}</dt>
            <dd>{format.dateTime(day(demo.ready_by), { dateStyle: 'medium' })}</dd>
          </>
        )}
      </dl>
      {r.estimate && (
        <p className='text-muted-foreground text-sm'>
          {t('estimate', {
            min: r.estimate.min_days,
            max: r.estimate.max_days ?? r.estimate.min_days
          })}
          {r.estimate.note ? ` · ${r.estimate.note}` : ''}
        </p>
      )}

      {paid && canEdit && (
        <form
          id={`demo-${r.id}`}
          className='space-y-3'
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit().catch(() => undefined);
          }}
        >
          <form.AppField
            name='status'
            children={(field) => <field.SelectField label={t('status')} options={steps} />}
          />
          <form.AppField
            name='message'
            children={(field) => (
              <field.TextareaField
                label={t('message')}
                placeholder={t('messagePlaceholder')}
                maxLength={600}
                rows={3}
              />
            )}
          />
          <form.AppField
            name='demoUrl'
            children={(field) => (
              <field.TextField
                label={t('url')}
                description={t('urlHint')}
                type='url'
                placeholder='https://'
              />
            )}
          />
          <form.AppField
            name='readyBy'
            children={(field) => <field.DatePickerField label={t('date')} />}
          />
          <form.AppField
            name='notify'
            children={(field) => <field.SwitchField label={t('notify')} />}
          />
          <LoadingButton type='submit' size='sm' loading={save.isPending}>
            {t('save')}
          </LoadingButton>
        </form>
      )}

      {demo.events.length > 0 && (
        <div className='space-y-1'>
          <p className='text-sm font-medium'>{t('timeline')}</p>
          <ol className='border-muted space-y-2 border-l pl-3 text-sm'>
            {demo.events.map((e, i) => (
              <li key={i}>
                <span className='font-medium'>{t(`statuses.${e.status}`)}</span>
                <span className='text-muted-foreground'>
                  {' · '}
                  {format.dateTime(new Date(e.at), { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
                {e.message && (
                  <p className='text-muted-foreground whitespace-pre-wrap'>{e.message}</p>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

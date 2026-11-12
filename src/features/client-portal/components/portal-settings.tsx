'use client';

import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';
import { Icons } from '@/components/icons';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
import { useErrorMessage } from '@/hooks/use-error-message';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import { useFields } from '@/lib/validation/use-fields';
import { majorToMinor, minorToMajor } from '@/features/payments/lib/money';
import { useSiteScope } from '@/features/site/components/use-site-scope';
import { portalKeys, portalSettingsQueryOptions } from '../api/queries';
import { savePortalPlan, savePortalSettings } from '../api/service';
import { PORTAL_PLAN_LEVELS, type PortalPlan, type PortalSettings } from '../api/types';

/**
 * What members get after joining: the free offer (how many days, which level
 * of information), the three monthly plans, and the phone numbers shown only
 * inside the member space. Everyone on the team sees it; admins change it.
 */
export function PortalSettingsPanel() {
  const scope = useSiteScope();
  const t = useTranslations('clientPortal.settings');
  const { data } = useSuspenseQuery(portalSettingsQueryOptions(createClient(), scope.websiteId));

  return (
    <div className='space-y-4'>
      {!data.can_admin && (
        <Alert>
          <Icons.lock aria-hidden />
          <AlertDescription>{t('adminOnly')}</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle>{t('model.title')}</CardTitle>
          <CardDescription>{t('model.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className='text-muted-foreground grid gap-2 text-sm sm:grid-cols-3'>
            {(['join', 'trial', 'plans'] as const).map((step, i) => (
              <li key={step} className='bg-muted/50 rounded-lg p-3'>
                <span className='text-foreground font-medium'>
                  {i + 1}. {t(`model.${step}Title`)}
                </span>
                <p className='mt-1'>{t(`model.${step}Text`)}</p>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
      <OfferForm settings={data} />
      <div className='grid gap-4 xl:grid-cols-3'>
        {PORTAL_PLAN_LEVELS.map((level) => (
          <PlanForm
            key={level}
            level={level}
            plan={data.plans.find((p) => p.level === level) ?? null}
            disabled={!data.can_admin}
          />
        ))}
      </div>
    </div>
  );
}

function OfferForm({ settings }: { settings: PortalSettings }) {
  const scope = useSiteScope();
  const t = useTranslations('clientPortal.settings');
  const f = useFields();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const disabled = !settings.can_admin;

  const schema = useMemo(
    () =>
      z.object({
        trialDays: z.number().int().min(0).max(60),
        trialLevel: f.oneOf(['1', '2', '3']),
        phone: f.phone(),
        whatsapp: f.phone(),
        note: f.text(300)
      }),
    [f]
  );
  const form = useAppForm({
    defaultValues: {
      trialDays: settings.trial_days as number | undefined,
      trialLevel: String(settings.trial_level),
      phone: settings.contact.phone ?? '',
      whatsapp: settings.contact.whatsapp ?? '',
      note: settings.contact.note ?? ''
    },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      const v = schema.parse(value);
      try {
        await savePortalSettings(createClient(), scope.websiteId, {
          trialDays: v.trialDays,
          trialLevel: Number(v.trialLevel),
          contact: {
            phone: v.phone || undefined,
            whatsapp: v.whatsapp || undefined,
            note: v.note || undefined
          }
        });
        toast.success(t('saved'));
        void queryClient.invalidateQueries({ queryKey: portalKeys.all(scope.websiteId) });
      } catch (error) {
        toast.error(errorMessage(error));
      }
    }
  });
  const levelName = (level: number) =>
    settings.plans.find((p) => p.level === level)?.name ?? t('levelN', { level });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('offer.title')}</CardTitle>
        <CardDescription>{t('offer.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
          className='space-y-4'
        >
          <fieldset disabled={disabled} className='space-y-4'>
            <FieldGroup className='grid gap-4 sm:grid-cols-2'>
              <form.AppField
                name='trialDays'
                children={(field) => (
                  <field.TextField
                    label={t('offer.days')}
                    description={t('offer.daysHint')}
                    type='number'
                    min={0}
                    max={60}
                    inputMode='numeric'
                  />
                )}
              />
              <form.AppField
                name='trialLevel'
                children={(field) => (
                  <field.SelectField
                    label={t('offer.level')}
                    description={t('offer.levelHint')}
                    options={PORTAL_PLAN_LEVELS.map((l) => ({
                      value: String(l),
                      label: t('offer.levelOption', { name: levelName(l) })
                    }))}
                  />
                )}
              />
            </FieldGroup>
            <div className='space-y-1'>
              <h3 className='text-sm font-medium'>{t('contact.title')}</h3>
              <p className='text-muted-foreground text-sm'>{t('contact.description')}</p>
            </div>
            <FieldGroup className='grid gap-4 sm:grid-cols-2'>
              <form.AppField
                name='phone'
                children={(field) => (
                  <field.TextField
                    label={t('contact.phone')}
                    type='tel'
                    autoComplete='off'
                    placeholder='+1 720 000 0000'
                    maxLength={40}
                    showCount={false}
                  />
                )}
              />
              <form.AppField
                name='whatsapp'
                children={(field) => (
                  <field.TextField
                    label={t('contact.whatsapp')}
                    type='tel'
                    autoComplete='off'
                    placeholder='+1 720 000 0000'
                    maxLength={40}
                    showCount={false}
                  />
                )}
              />
            </FieldGroup>
            <form.AppField
              name='note'
              children={(field) => (
                <field.TextField
                  label={t('contact.note')}
                  description={t('contact.noteHint')}
                  maxLength={300}
                />
              )}
            />
          </fieldset>
          {!disabled && (
            <form.AppForm>
              <form.SubmitButton>{t('save')}</form.SubmitButton>
            </form.AppForm>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function PlanForm({
  level,
  plan,
  disabled
}: {
  level: number;
  plan: PortalPlan | null;
  disabled: boolean;
}) {
  const scope = useSiteScope();
  const t = useTranslations('clientPortal.settings');
  const f = useFields();
  const tv = useTranslations('validation');
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const currency = plan?.currency ?? 'usd';

  const schema = useMemo(
    () =>
      z
        .object({
          name: f.text(60, { min: 1 }),
          price: f.amount({ required: true, max: 100000 }),
          description: f.text(300),
          features: f.text(1200, { multiline: true }),
          active: z.boolean()
        })
        .superRefine((v, ctx) => {
          if (Number(v.price) < 1)
            ctx.addIssue({ code: 'custom', path: ['price'], message: t('plan.minPrice') });
          const lines = v.features
            .split('\n')
            .map((x) => x.trim())
            .filter(Boolean);
          if (lines.length > 8)
            ctx.addIssue({
              code: 'custom',
              path: ['features'],
              message: tv('maxItems', { max: 8 })
            });
          if (lines.some((x) => x.length > 120)) {
            ctx.addIssue({
              code: 'custom',
              path: ['features'],
              message: tv('maxLength', { max: 120 })
            });
          }
        }),
    [f, t, tv]
  );
  const form = useAppForm({
    defaultValues: {
      name: plan?.name ?? '',
      price: plan ? String(minorToMajor(plan.amount, currency)) : '',
      description: plan?.description ?? '',
      features: (plan?.features ?? []).join('\n'),
      active: plan?.active ?? true
    },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      const v = schema.parse(value);
      try {
        await savePortalPlan(createClient(), scope.websiteId, {
          level,
          name: v.name,
          description: v.description,
          features: v.features
            .split('\n')
            .map((x) => x.trim())
            .filter(Boolean),
          amount: majorToMinor(Number(v.price), currency),
          currency,
          active: v.active
        });
        toast.success(t('plan.saved', { name: v.name }));
        void queryClient.invalidateQueries({ queryKey: portalKeys.all(scope.websiteId) });
      } catch (error) {
        toast.error(errorMessage(error));
      }
    }
  });

  return (
    <Card className='h-full'>
      <CardHeader>
        <div className='flex items-center justify-between gap-2'>
          <CardTitle>{t('plan.title', { level })}</CardTitle>
          {plan ? (
            <Badge variant={plan.active ? 'secondary' : 'outline'}>
              {plan.active ? t('plan.subscribers', { count: plan.subscribers }) : t('plan.hidden')}
            </Badge>
          ) : (
            <Badge variant='outline'>{t('plan.notSet')}</Badge>
          )}
        </div>
        <CardDescription>{t(`plan.hint${level}` as 'plan.hint1')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
          className='space-y-4'
        >
          <fieldset disabled={disabled}>
            <FieldGroup>
              <form.AppField
                name='name'
                children={(field) => (
                  <field.TextField label={t('plan.name')} maxLength={60} required />
                )}
              />
              <form.AppField
                name='price'
                children={(field) => (
                  <field.TextField
                    label={t('plan.price', { currency: currency.toUpperCase() })}
                    description={t('plan.priceHint')}
                    inputMode='decimal'
                    placeholder='15'
                    required
                    showCount={false}
                    maxLength={12}
                  />
                )}
              />
              <form.AppField
                name='description'
                children={(field) => (
                  <field.TextField label={t('plan.description')} maxLength={300} />
                )}
              />
              <form.AppField
                name='features'
                children={(field) => (
                  <field.TextareaField
                    label={t('plan.features')}
                    description={t('plan.featuresHint')}
                    rows={4}
                  />
                )}
              />
              <form.AppField
                name='active'
                children={(field) => (
                  <field.SwitchField label={t('plan.active')} description={t('plan.activeHint')} />
                )}
              />
            </FieldGroup>
          </fieldset>
          {!disabled && (
            <form.AppForm>
              <form.SubmitButton>{t('plan.save')}</form.SubmitButton>
            </form.AppForm>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

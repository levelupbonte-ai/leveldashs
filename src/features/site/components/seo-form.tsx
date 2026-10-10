'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
import { Icons } from '@/components/icons';
import { LoadingButton } from '@/components/ui/loading-button';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';
import { useSiteMutations } from '../api/mutations';
import { seoQueryOptions } from '../api/queries';
import type { SeoSettings } from '../api/types';
import { JsonEditorCard } from './json-editor-card';
import { useSiteScope } from './use-site-scope';

const BUSINESS_TYPES = [
  'LocalBusiness',
  'BarberShop',
  'BeautySalon',
  'HairSalon',
  'Restaurant',
  'Store',
  'ProfessionalService',
  'HealthAndBeautyBusiness',
  'SportsActivityLocation',
  'Organization',
  'Person'
].map((v) => ({ value: v, label: v }));

const PAGES_EXAMPLE = '{ "/services": { "title": "…", "description": "…" } }';

function toValues(seo: SeoSettings) {
  return {
    enabled: seo.enabled !== false,
    title: seo.title ?? '',
    description: seo.description ?? '',
    keywords: seo.keywords ?? [],
    image: seo.image ?? '',
    business_name: seo.business_name ?? '',
    business_type: seo.business_type ?? 'LocalBusiness',
    google_site_verification: seo.google_site_verification ?? ''
  };
}

export function SeoForm() {
  const scope = useSiteScope();
  const { data: seo } = useSuspenseQuery(seoQueryOptions(createClient(), scope.websiteId));
  const { saveSetting } = useSiteMutations(scope);
  const t = useTranslations('site.seo');
  const tv = useTranslations('validation');
  const tsv = useTranslations('site.validation');
  const seoSchema = useMemo(
    () =>
      z.object({
        enabled: z.boolean(),
        title: z
          .string()
          .trim()
          .max(70, { message: tv('maxLength', { max: 70 }) }),
        description: z
          .string()
          .trim()
          .max(320, { message: tv('maxLength', { max: 320 }) }),
        keywords: z.array(z.string().trim().min(1).max(60)).max(20),
        image: z
          .string()
          .trim()
          .refine((v) => v === '' || /^https:\/\/\S+$/.test(v), { message: tsv('https') }),
        business_name: z.string().trim().max(120),
        business_type: z.string(),
        google_site_verification: z
          .string()
          .trim()
          .refine((v) => v === '' || /^[A-Za-z0-9_-]{10,100}$/.test(v), {
            message: t('invalidCode')
          })
      }),
    [t, tv, tsv]
  );

  const save = (next: SeoSettings) =>
    saveSetting.mutateAsync({ key: 'seo', value: next }).then(() => toast.success(t('saved')));

  const form = useAppForm({
    defaultValues: toValues(seo),
    validators: { onSubmit: seoSchema },
    onSubmit: async ({ value }) => {
      const next: SeoSettings = { ...seo, enabled: value.enabled, keywords: value.keywords };
      for (const k of [
        'title',
        'description',
        'image',
        'business_name',
        'business_type',
        'google_site_verification'
      ] as const) {
        const v = value[k].trim();
        if (v) next[k] = v;
        else delete next[k];
      }
      try {
        await save(next);
      } catch {
        // toast shown by the mutation
      }
    }
  });

  return (
    <div className='grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]'>
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className='space-y-4'
            onSubmit={(e) => {
              e.preventDefault();
              form.handleSubmit();
            }}
          >
            <FieldGroup>
              <form.AppField
                name='enabled'
                children={(field) => (
                  <field.SwitchField label={t('enabled')} description={t('enabledHint')} />
                )}
              />
              <form.AppField
                name='title'
                children={(field) => (
                  <field.TextField
                    label={t('metaTitle')}
                    maxLength={70}
                    placeholder={t('metaTitlePlaceholder')}
                    description={t('metaTitleHint')}
                  />
                )}
              />
              <form.AppField
                name='description'
                children={(field) => (
                  <field.TextareaField
                    label={t('metaDescription')}
                    rows={3}
                    maxLength={320}
                    showCount
                    description={t('metaDescriptionHint')}
                  />
                )}
              />
              <form.AppField
                name='keywords'
                children={(field) => (
                  <field.TagsField label={t('keywords')} placeholder={t('keywordsPlaceholder')} />
                )}
              />
              <form.AppField
                name='image'
                children={(field) => (
                  <field.TextField
                    label={t('image')}
                    placeholder='https://…'
                    description={t('imageHint')}
                  />
                )}
              />
              <form.AppField
                name='business_name'
                children={(field) => <field.TextField label={t('businessName')} maxLength={120} />}
              />
              <form.AppField
                name='business_type'
                children={(field) => (
                  <field.SelectField label={t('businessType')} options={BUSINESS_TYPES} />
                )}
              />
              <form.AppField
                name='google_site_verification'
                children={(field) => (
                  <field.TextField
                    label={t('verification')}
                    placeholder='abc123…'
                    description={t('verificationHint')}
                  />
                )}
              />
            </FieldGroup>
            <form.Subscribe
              selector={(s) => s.isSubmitting}
              children={(submitting) => (
                <LoadingButton type='submit' loading={submitting} disabled={!scope.canEdit}>
                  {t('save')}
                </LoadingButton>
              )}
            />
          </form>
        </CardContent>
      </Card>

      <div className='space-y-6'>
        <Alert>
          <Icons.info className='size-4' />
          <AlertDescription>{t('tagNotice')}</AlertDescription>
        </Alert>
        <JsonEditorCard
          key={JSON.stringify(seo.pages ?? {})}
          title={t('pages')}
          description={t('pagesHint', { example: PAGES_EXAMPLE })}
          value={seo.pages ?? {}}
          disabled={!scope.canEdit}
          saving={saveSetting.isPending}
          onSave={(pages) => {
            if (!pages || typeof pages !== 'object' || Array.isArray(pages)) {
              toast.error(t('pagesFormat', { example: '{ "/path": { "title": "…" } }' }));
              return;
            }
            void save({ ...seo, pages: pages as SeoSettings['pages'] }).catch(() => {});
          }}
        />
      </div>
    </div>
  );
}

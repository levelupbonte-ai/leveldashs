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
import { useFields } from '@/lib/validation/use-fields';
import { useSiteMutations } from '../api/mutations';
import { seoQueryOptions } from '../api/queries';
import type { SeoSettings } from '../api/types';
import { JsonEditorCard } from './json-editor-card';
import { useSiteScope } from './use-site-scope';

const BUSINESS_TYPE_VALUES = [
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
] as const;
const BUSINESS_TYPES = BUSINESS_TYPE_VALUES.map((v) => ({ value: v, label: v }));

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

const SEO_TITLE_MAX = 60;
const SEO_DESCRIPTION_MAX = 160;

export function SeoForm() {
  const scope = useSiteScope();
  const { data: seo } = useSuspenseQuery(seoQueryOptions(createClient(), scope.websiteId));
  const { saveSetting } = useSiteMutations(scope);
  const t = useTranslations('site.seo');
  const f = useFields();
  const seoSchema = useMemo(
    () =>
      z.object({
        enabled: z.boolean(),
        // What search engines show (title ~60, description ~160 characters);
        // the database accepts up to 70 / 320 (website_settings_seo_len_check).
        title: f.text(SEO_TITLE_MAX),
        description: f.text(SEO_DESCRIPTION_MAX, { multiline: true }),
        keywords: f.tags(20, 60),
        image: f.url({ httpsOnly: true }),
        business_name: f.text(120),
        business_type: f.oneOf(BUSINESS_TYPE_VALUES),
        google_site_verification: f
          .text(100)
          .refine((v) => v === '' || /^[A-Za-z0-9_-]{10,100}$/.test(v), {
            message: t('invalidCode')
          })
      }),
    [f, t]
  );

  const save = (next: SeoSettings) =>
    saveSetting.mutateAsync({ key: 'seo', value: next }).then(() => toast.success(t('saved')));

  const form = useAppForm({
    defaultValues: toValues(seo),
    validators: { onSubmit: seoSchema },
    onSubmit: async ({ value: raw }) => {
      // The cleaned values (schema output), never the raw input.
      const value = seoSchema.parse(raw);
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
                    maxLength={SEO_TITLE_MAX}
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
                    maxLength={SEO_DESCRIPTION_MAX}
                    description={t('metaDescriptionHint')}
                  />
                )}
              />
              <form.AppField
                name='keywords'
                children={(field) => (
                  <field.TagsField
                    label={t('keywords')}
                    placeholder={t('keywordsPlaceholder')}
                    maxLength={60}
                    maxItems={20}
                  />
                )}
              />
              <form.AppField
                name='image'
                children={(field) => (
                  <field.TextField
                    label={t('image')}
                    inputMode='url'
                    maxLength={2048}
                    showCount={false}
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
                    maxLength={100}
                    showCount={false}
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

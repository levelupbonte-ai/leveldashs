'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
import { Icons } from '@/components/icons';
import { LoadingButton } from '@/components/ui/loading-button';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import { useSuspenseQuery } from '@tanstack/react-query';
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

const httpsOrEmpty = z
  .string()
  .trim()
  .refine((v) => v === '' || /^https:\/\/\S+$/.test(v), { message: 'Lien https:// requis' });

const seoSchema = z.object({
  enabled: z.boolean(),
  title: z.string().trim().max(70, { message: '70 caractères maximum' }),
  description: z.string().trim().max(320, { message: '320 caractères maximum' }),
  keywords: z.array(z.string().trim().min(1).max(60)).max(20),
  image: httpsOrEmpty,
  business_name: z.string().trim().max(120),
  business_type: z.string(),
  google_site_verification: z
    .string()
    .trim()
    .refine((v) => v === '' || /^[A-Za-z0-9_-]{10,100}$/.test(v), { message: 'Code invalide' })
});

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

  const save = (next: SeoSettings) =>
    saveSetting
      .mutateAsync({ key: 'seo', value: next })
      .then(() => toast.success('SEO enregistré'));

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
    <div className='grid gap-6 xl:grid-cols-[1fr_380px]'>
      <Card>
        <CardHeader>
          <CardTitle>Référencement Google</CardTitle>
          <CardDescription>
            Appliqué automatiquement par le tag LevelUp sur votre site : titre, description, aperçu
            de partage et fiche entreprise (schema.org) avec vos coordonnées, horaires et avis.
          </CardDescription>
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
                  <field.SwitchField
                    label='Activer le SEO LevelUp'
                    description='Désactivez si votre site gère déjà ses balises.'
                  />
                )}
              />
              <form.AppField
                name='title'
                children={(field) => (
                  <field.TextField
                    label='Titre (Google)'
                    maxLength={70}
                    placeholder='Barbier à San Diego | Final Stop'
                    description='50 à 60 caractères : activité + ville + nom.'
                  />
                )}
              />
              <form.AppField
                name='description'
                children={(field) => (
                  <field.TextareaField
                    label='Description'
                    rows={3}
                    maxLength={320}
                    showCount
                    description='140 à 160 caractères, avec un appel à l’action.'
                  />
                )}
              />
              <form.AppField
                name='keywords'
                children={(field) => (
                  <field.TagsField label='Mots-clés' placeholder='Tapez puis Entrée…' />
                )}
              />
              <form.AppField
                name='image'
                children={(field) => (
                  <field.TextField
                    label='Image de partage'
                    placeholder='https://…'
                    description='1200 × 630 px. Copiez un lien depuis la Médiathèque.'
                  />
                )}
              />
              <form.AppField
                name='business_name'
                children={(field) => (
                  <field.TextField label='Nom de l’entreprise' maxLength={120} />
                )}
              />
              <form.AppField
                name='business_type'
                children={(field) => (
                  <field.SelectField label='Type d’entreprise' options={BUSINESS_TYPES} />
                )}
              />
              <form.AppField
                name='google_site_verification'
                children={(field) => (
                  <field.TextField
                    label='Code Google Search Console'
                    placeholder='abc123…'
                    description='Le contenu de la balise google-site-verification.'
                  />
                )}
              />
            </FieldGroup>
            <form.Subscribe
              selector={(s) => s.isSubmitting}
              children={(submitting) => (
                <LoadingButton type='submit' loading={submitting} disabled={!scope.canEdit}>
                  Enregistrer
                </LoadingButton>
              )}
            />
          </form>
        </CardContent>
      </Card>

      <div className='space-y-6'>
        <Alert>
          <Icons.info className='size-4' />
          <AlertDescription>
            Le tag LevelUp doit être installé sur le site (onglet Développeurs). Google lit ces
            balises ; certains réseaux sociaux (Facebook, WhatsApp) ne lisent que le code HTML
            d’origine.
          </AlertDescription>
        </Alert>
        <JsonEditorCard
          key={JSON.stringify(seo.pages ?? {})}
          title='Pages'
          description='Titre et description par page, ex. { "/services": { "title": "…", "description": "…" } }'
          value={seo.pages ?? {}}
          disabled={!scope.canEdit}
          saving={saveSetting.isPending}
          onSave={(pages) => {
            if (!pages || typeof pages !== 'object' || Array.isArray(pages)) {
              toast.error('Format attendu : { "/chemin": { "title": "…" } }');
              return;
            }
            void save({ ...seo, pages: pages as SeoSettings['pages'] }).catch(() => {});
          }}
        />
      </div>
    </div>
  );
}

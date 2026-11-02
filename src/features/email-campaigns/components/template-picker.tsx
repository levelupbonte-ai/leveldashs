'use client';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import {
  CAMPAIGN_TEMPLATES,
  renderCampaign,
  type CampaignBrand,
  type CampaignTemplate,
  type FooterLabels
} from '../lib/render';
import { EmailFrame } from './email-preview';
import { useTemplateDefaults } from './use-template-defaults';

/** Six templates, each with a live thumbnail in the site's branding. */
export function TemplatePicker({
  value,
  onChange,
  brand,
  labels,
  locale,
  disabled
}: {
  value: CampaignTemplate;
  onChange: (value: CampaignTemplate) => void;
  brand: CampaignBrand;
  labels: FooterLabels;
  locale: 'en' | 'fr';
  disabled?: boolean;
}) {
  const t = useTranslations('emailCampaigns.templates');
  const defaults = useTemplateDefaults();
  const previews = useMemo(
    () =>
      Object.fromEntries(
        CAMPAIGN_TEMPLATES.map((template) => [
          template,
          renderCampaign(
            {
              ...defaults(template),
              buttonUrl: `https://${brand.siteDomain ?? 'example.com'}`,
              template,
              locale,
              imageUrl: null
            },
            brand,
            labels,
            {
              unsubscribeUrl: null,
              preview: true
            }
          ).html
        ])
      ) as Record<CampaignTemplate, string>,
    [brand, labels, locale, defaults]
  );

  return (
    <div
      role='radiogroup'
      aria-label={t('label')}
      className='grid grid-cols-2 gap-3 lg:grid-cols-3'
    >
      {CAMPAIGN_TEMPLATES.map((template) => {
        const selected = value === template;
        return (
          <button
            key={template}
            type='button'
            role='radio'
            aria-checked={selected}
            aria-label={t(`${template}.name`)}
            disabled={disabled}
            onClick={() => onChange(template)}
            className={cn(
              'group bg-card relative overflow-hidden rounded-xl border text-left transition',
              'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
              selected ? 'border-primary ring-primary ring-1' : 'hover:border-foreground/30',
              disabled && 'cursor-not-allowed opacity-60'
            )}
          >
            <div
              className='pointer-events-none relative h-40 overflow-hidden bg-[#f3f4f6]'
              aria-hidden
            >
              <div className='absolute top-0 left-0 h-[800px] w-[640px] origin-top-left scale-[0.3] sm:scale-[0.34]'>
                <EmailFrame html={previews[template]} title={t(`${template}.name`)} />
              </div>
            </div>
            <div className='border-t p-3'>
              <p className='flex items-center gap-1.5 text-sm font-medium'>
                {selected && <Icons.check className='text-primary size-4' aria-hidden />}
                {t(`${template}.name`)}
              </p>
              <p className='text-muted-foreground line-clamp-2 text-xs'>
                {t(`${template}.description`)}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

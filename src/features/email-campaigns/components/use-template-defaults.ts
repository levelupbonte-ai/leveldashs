'use client';
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import type { CampaignTemplate } from '../lib/render';

/** Starting copy of each template, in the dashboard's language (the user rewrites it). */
export function useTemplateDefaults() {
  const t = useTranslations('emailCampaigns.templates');
  return useCallback(
    (template: CampaignTemplate) => ({
      subject: t(`${template}.subject`),
      previewText: t(`${template}.previewText`),
      heading: t(`${template}.heading`),
      body: t(`${template}.body`),
      buttonLabel: t(`${template}.button`) || null,
      buttonUrl: null as string | null
    }),
    [t]
  );
}

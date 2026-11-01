'use client';
import { createContext, useContext } from 'react';
import type { EmailBrand, FooterLabelSet } from '../api/types';
import { mediaPublicUrl, type CampaignBrand, type FooterLabels } from '../lib/render';
import { SUPABASE_URL } from '@/lib/supabase/env';

export interface EmailPageConfig {
  /** Footer wording in English and French (e-mail messages are not shipped to the browser). */
  footerLabels: FooterLabelSet;
  /** The background worker is set up, so scheduled campaigns start on time. */
  schedulingAvailable: boolean;
  /** The e-mail provider key is set on the server. */
  providerReady: boolean;
}

const EmailConfigContext = createContext<EmailPageConfig | null>(null);

export const EmailConfigProvider = EmailConfigContext.Provider;

export function useEmailConfig(): EmailPageConfig {
  const value = useContext(EmailConfigContext);
  if (!value) throw new Error('useEmailConfig outside EmailConfigProvider');
  return value;
}

export function toCampaignBrand(brand: EmailBrand): CampaignBrand {
  return {
    businessName: brand.business_name,
    siteName: brand.site_name,
    siteDomain: brand.site_domain,
    logoUrl: brand.logo_url,
    brandColor: brand.brand_color,
    postalAddress: brand.postal_address
  };
}

export const imageUrlFor = (path: string | null) => mediaPublicUrl(SUPABASE_URL, path);

/** The site name used in "You subscribed on …". */
export const siteLabel = (brand: EmailBrand) => brand.site_domain || brand.site_name;

/** Footer wording of one language with the site filled in ("…subscribed on finalstop.org"). */
export function labelsFor(
  set: FooterLabelSet,
  locale: 'en' | 'fr',
  brand: EmailBrand
): FooterLabels {
  const labels = set[locale];
  return { ...labels, reason: labels.reason.replace('{site}', siteLabel(brand)) };
}

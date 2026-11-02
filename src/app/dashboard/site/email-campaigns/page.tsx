import type { Metadata } from 'next';
import type { SearchParams } from 'nuqs/server';
import { getTranslations } from 'next-intl/server';
import {
  campaignsQueryOptions,
  contactsQueryOptions,
  emailOverviewQueryOptions
} from '@/features/email-campaigns/api/queries';
import type { FooterLabelSet } from '@/features/email-campaigns/api/types';
import { EmailCampaignsView } from '@/features/email-campaigns/components/email-campaigns-view';
import { toContactFilters } from '@/features/email-campaigns/lib/filters';
import { emailProviderConfigured } from '@/features/email-campaigns/server/sender';
import { SitePage } from '@/features/site/components/site-page';
import { getTranslatorFor } from '@/i18n/messages';
import { emailSearchParamsCache } from '@/lib/searchparams';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('site.pages.emailCampaigns');
  return { title: t('title') };
}

/** Footer wording of both languages, with `{site}` left for the preview to fill. */
async function footerLabelSet(): Promise<FooterLabelSet> {
  const out = {} as FooterLabelSet;
  for (const locale of ['en', 'fr'] as const) {
    const { t } = await getTranslatorFor(locale);
    out[locale] = {
      reason: t('emails.campaign.reason', { site: '{site}' }),
      unsubscribe: t('emails.campaign.unsubscribe'),
      addressMissing: t('emails.campaign.addressMissing')
    };
  }
  return out;
}

export default async function Page(props: { searchParams: Promise<SearchParams> }) {
  const params = emailSearchParamsCache.parse(await props.searchParams);
  const t = await getTranslations('site.pages.emailCampaigns');
  const footerLabels = await footerLabelSet();
  return (
    <SitePage
      title={t('title')}
      description={t('description')}
      prefetch={(qc, db, websiteId) => {
        void qc.prefetchQuery(emailOverviewQueryOptions(db, websiteId));
        void qc.prefetchQuery(campaignsQueryOptions(db, websiteId));
        void qc.prefetchQuery(contactsQueryOptions(db, websiteId, toContactFilters(params)));
      }}
    >
      <EmailCampaignsView
        footerLabels={footerLabels}
        providerReady={emailProviderConfigured()}
        schedulingAvailable={!!process.env.CRON_SECRET && !!process.env.LEVELUP_EMAIL_KEY}
      />
    </SitePage>
  );
}

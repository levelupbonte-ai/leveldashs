import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { waitlistQueryOptions } from '@/features/site/api/queries';
import { SitePage } from '@/features/site/components/site-page';
import { WaitlistBoard } from '@/features/site/components/waitlist-board';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('site.pages.waitlist');
  return { title: t('title') };
}

export default async function Page() {
  const t = await getTranslations('site.pages.waitlist');
  return (
    <SitePage
      title={t('title')}
      description={t('description')}
      feature='waitlist'
      prefetch={(qc, db, websiteId) => void qc.prefetchQuery(waitlistQueryOptions(db, websiteId))}
    >
      <WaitlistBoard />
    </SitePage>
  );
}

import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { seoQueryOptions } from '@/features/site/api/queries';
import { SeoForm } from '@/features/site/components/seo-form';
import { SitePage } from '@/features/site/components/site-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('site.pages.seo');
  return { title: t('title') };
}

export default async function Page() {
  const t = await getTranslations('site.pages.seo');
  return (
    <SitePage
      title={t('title')}
      description={t('description')}
      prefetch={(qc, db, websiteId) => void qc.prefetchQuery(seoQueryOptions(db, websiteId))}
    >
      <SeoForm />
    </SitePage>
  );
}

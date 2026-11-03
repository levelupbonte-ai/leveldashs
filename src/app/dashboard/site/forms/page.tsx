import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SitePage } from '@/features/site/components/site-page';
import { FormsManager } from '@/features/forms/components/forms-manager';
import { formsQueryOptions } from '@/features/forms/api/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('site.pages.forms');
  return { title: t('title') };
}

export default async function Page() {
  const t = await getTranslations('site.pages.forms');
  return (
    <SitePage
      title={t('title')}
      description={t('description')}
      prefetch={(qc, db, websiteId) => {
        void qc.prefetchQuery(formsQueryOptions(db, websiteId));
      }}
    >
      <FormsManager />
    </SitePage>
  );
}

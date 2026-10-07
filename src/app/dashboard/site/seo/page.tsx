import { seoQueryOptions } from '@/features/site/api/queries';
import { SeoForm } from '@/features/site/components/seo-form';
import { SitePage } from '@/features/site/components/site-page';

export const metadata = { title: 'SEO' };

export default function Page() {
  return (
    <SitePage
      title='SEO'
      description='Visibilité sur Google et aperçus de partage'
      prefetch={(qc, db, websiteId) => void qc.prefetchQuery(seoQueryOptions(db, websiteId))}
    >
      <SeoForm />
    </SitePage>
  );
}

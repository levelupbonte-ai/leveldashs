import { mediaQueryOptions } from '@/features/site/api/queries';
import { MediaLibrary } from '@/features/site/components/media-library';
import { SitePage } from '@/features/site/components/site-page';

export const metadata = { title: 'Médiathèque' };

export default function Page() {
  return (
    <SitePage
      title='Médiathèque'
      description='Images et fichiers de votre site'
      prefetch={(qc, db, websiteId) => void qc.prefetchQuery(mediaQueryOptions(db, websiteId))}
    >
      <MediaLibrary />
    </SitePage>
  );
}

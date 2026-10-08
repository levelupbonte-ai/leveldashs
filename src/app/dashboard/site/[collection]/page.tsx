import { notFound } from 'next/navigation';
import { collectionQueryOptions } from '@/features/site/api/queries';
import { CollectionManager } from '@/features/site/components/collection-manager';
import { SitePage } from '@/features/site/components/site-page';
import { getCollection, type CollectionKey } from '@/features/site/config/collections';

export async function generateMetadata(props: { params: Promise<{ collection: string }> }) {
  const { collection } = await props.params;
  return { title: getCollection(collection)?.title ?? 'Site' };
}

export default async function Page(props: { params: Promise<{ collection: string }> }) {
  const { collection } = await props.params;
  const def = getCollection(collection);
  if (!def) notFound();

  return (
    <SitePage
      title={def.title}
      description={def.description}
      feature={def.feature}
      prefetch={(qc, db, websiteId) =>
        void qc.prefetchQuery(collectionQueryOptions(db, def, websiteId))
      }
    >
      <CollectionManager collection={def.key as CollectionKey} />
    </SitePage>
  );
}

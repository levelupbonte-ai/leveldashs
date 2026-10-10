import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { collectionQueryOptions } from '@/features/site/api/queries';
import { CollectionManager } from '@/features/site/components/collection-manager';
import { SitePage } from '@/features/site/components/site-page';
import { getCollection, type CollectionKey } from '@/features/site/config/collections';

export async function generateMetadata(props: {
  params: Promise<{ collection: string }>;
}): Promise<Metadata> {
  const { collection } = await props.params;
  const def = getCollection(collection);
  if (!def) return {};
  const t = await getTranslations('site.collections');
  return { title: t(`${def.key}.title`) };
}

export default async function Page(props: { params: Promise<{ collection: string }> }) {
  const { collection } = await props.params;
  const def = getCollection(collection);
  if (!def) notFound();
  const t = await getTranslations('site.collections');

  return (
    <SitePage
      title={t(`${def.key}.title`)}
      description={t(`${def.key}.description`)}
      feature={def.feature}
      prefetch={(qc, db, websiteId) =>
        void qc.prefetchQuery(collectionQueryOptions(db, def, websiteId))
      }
    >
      <CollectionManager collection={def.key as CollectionKey} />
    </SitePage>
  );
}

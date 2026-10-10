import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import PageContainer from '@/components/layout/page-container';
import { getWorkspacesInfoContent } from '@/config/infoconfig';
import { WorkspacesView } from '@/features/organizations/components/workspaces-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('workspaces');
  return { title: t('title') };
}

export default async function WorkspacesPage() {
  const t = await getTranslations('workspaces');
  return (
    <PageContainer
      pageTitle={t('title')}
      pageDescription={t('description')}
      infoContent={await getWorkspacesInfoContent()}
    >
      <WorkspacesView />
    </PageContainer>
  );
}

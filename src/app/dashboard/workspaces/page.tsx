import PageContainer from '@/components/layout/page-container';
import { workspacesInfoContent } from '@/config/infoconfig';
import { WorkspacesView } from '@/features/organizations/components/workspaces-view';

export const metadata = { title: 'Organisations' };

export default function WorkspacesPage() {
  return (
    <PageContainer
      pageTitle='Organisations'
      pageDescription='Vos entreprises et les sites qui y sont reliés'
      infoContent={workspacesInfoContent}
    >
      <WorkspacesView />
    </PageContainer>
  );
}

import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AssistantChat } from '@/features/assistant/components/assistant-chat';
import { SitePage } from '@/features/site/components/site-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('site.pages.assistant');
  return { title: t('title') };
}

export default async function Page() {
  const t = await getTranslations('site.pages.assistant');
  return (
    <SitePage title={t('title')} description={t('description')} prefetch={() => {}}>
      <AssistantChat />
    </SitePage>
  );
}

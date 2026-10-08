import { AiUsageCard } from '@/features/assistant/components/ai-usage-card';
import { AssistantChat } from '@/features/assistant/components/assistant-chat';
import { SitePage } from '@/features/site/components/site-page';

export const metadata = { title: 'Assistant IA' };

export default function Page() {
  return (
    <SitePage
      title='Assistant IA'
      description='Questions, textes et aide sur votre site'
      prefetch={() => {}}
    >
      <AssistantChat />
      <AiUsageCard />
    </SitePage>
  );
}

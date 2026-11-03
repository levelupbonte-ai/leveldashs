'use client';

import { useSuspenseQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { parseAsStringLiteral, useQueryStates } from 'nuqs';
import { useEffect, useRef } from 'react';
import { Icons } from '@/components/icons';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RawSettings } from './developers/raw-settings';
import { DeveloperActivityCard } from '@/features/api-keys/components/developer-activity';
import { ServerKeysCard } from '@/features/api-keys/components/server-keys-card';
import { useNow } from '@/features/insights/lib/use-now';
import { createClient } from '@/lib/supabase/client';
import { integrationQueryOptions } from '../api/queries';
import { JavaScriptGuide, PaymentsGuide, QuickStart } from './developers/guides';
import { DevelopersOverview, tagInstalled } from './developers/overview';
import { useSiteScope } from './use-site-scope';

export { TAG_URL } from './developers/snippets';

const TABS = ['quickstart', 'javascript', 'keys', 'payments', 'activity', 'raw'] as const;
type Tab = (typeof TABS)[number];
const TAB_ICONS = {
  quickstart: Icons.circleCheck,
  javascript: Icons.code,
  keys: Icons.key,
  payments: Icons.creditCard,
  activity: Icons.activity,
  raw: Icons.code
} satisfies Record<Tab, unknown>;

/**
 * Developers page: overview (site ID, environment, tag status, domains) and
 * guides in tabs. Everyone reads the docs; owners and admins also manage server
 * keys and see the activity log (RLS returns nothing to the other roles).
 */
export function DevelopersPanel() {
  const scope = useSiteScope();
  const { data: site } = useSuspenseQuery(integrationQueryOptions(createClient(), scope.websiteId));
  const [{ tab }, setParams] = useQueryStates(
    { tab: parseAsStringLiteral(TABS).withDefault('quickstart') },
    { shallow: true, history: 'replace' }
  );
  const t = useTranslations('site.developers.tabs');
  const now = useNow();
  const tabs = TABS.filter((k) => (k !== 'activity' && k !== 'raw') || scope.canAdmin);
  const current: Tab = tabs.includes(tab) ? tab : 'quickstart';
  const strip = useRef<HTMLDivElement>(null);

  // Phones: keep the selected tab visible in the scrollable strip.
  useEffect(() => {
    strip.current
      ?.querySelector(`#dev-tab-${current}`)
      ?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [current]);

  return (
    <div className='space-y-6'>
      <DevelopersOverview site={site} />
      <Tabs value={current} onValueChange={(value) => void setParams({ tab: value as Tab })}>
        <div ref={strip} className='-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0'>
          <TabsList variant='line' className='w-max min-w-full justify-start border-b sm:min-w-0'>
            {tabs.map((key) => {
              const Icon = TAB_ICONS[key];
              return (
                <TabsTrigger key={key} id={`dev-tab-${key}`} value={key} className='flex-none px-3'>
                  <Icon className='size-4' aria-hidden />
                  {t(key)}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>
        <TabsContent value='quickstart' className='pt-4'>
          <QuickStart site={site} installed={tagInstalled(site, now)} />
        </TabsContent>
        <TabsContent value='javascript' className='pt-4'>
          <JavaScriptGuide />
        </TabsContent>
        <TabsContent value='keys' className='pt-4'>
          <ServerKeysCard />
        </TabsContent>
        <TabsContent value='payments' className='pt-4'>
          <PaymentsGuide />
        </TabsContent>
        {scope.canAdmin && (
          <TabsContent value='activity' className='pt-4'>
            <DeveloperActivityCard />
          </TabsContent>
        )}
        {scope.canAdmin && (
          <TabsContent value='raw' className='pt-4'>
            <RawSettings />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

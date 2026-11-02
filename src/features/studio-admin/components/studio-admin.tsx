'use client';

import { useQueryStates } from 'nuqs';
import { useTranslations } from 'next-intl';
import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { STUDIO_TABS, studioParams, type StudioTab } from '../lib/filters';
import { StudioSitesTab } from './sites-tab';
import { StudioTemplatesTab } from './templates-tab';

/** LevelStudio staff section: the template catalog and the sites people created. */
export function StudioAdmin() {
  const t = useTranslations('admin.studio');
  const [{ tab }, setParams] = useQueryStates(studioParams, { shallow: true, history: 'replace' });
  return (
    <Tabs value={tab} onValueChange={(v) => void setParams({ tab: v as StudioTab })}>
      <TabsList>
        {STUDIO_TABS.map((value) => (
          <TabsTrigger key={value} value={value}>
            {t(`tabs.${value}`)}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value='templates' className='mt-4'>
        <Suspense fallback={<Skeleton className='h-96 w-full' />}>
          <StudioTemplatesTab />
        </Suspense>
      </TabsContent>
      <TabsContent value='sites' className='mt-4'>
        <Suspense fallback={<Skeleton className='h-96 w-full' />}>
          <StudioSitesTab />
        </Suspense>
      </TabsContent>
    </Tabs>
  );
}

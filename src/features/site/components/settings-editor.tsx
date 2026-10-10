'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Icons } from '@/components/icons';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { createClient } from '@/lib/supabase/client';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useSiteMutations } from '../api/mutations';
import { blocksQueryOptions, settingsQueryOptions } from '../api/queries';
import { JsonEditorCard } from './json-editor-card';
import { useSiteScope } from './use-site-scope';

const SETTING_HELP = [
  'contact',
  'hours',
  'booking',
  'waitlist',
  'social',
  'branding',
  'seo'
] as const;

export function SettingsEditor() {
  const scope = useSiteScope();
  const db = createClient();
  const { data: settings } = useSuspenseQuery(settingsQueryOptions(db, scope.websiteId));
  const { data: blocks } = useSuspenseQuery(blocksQueryOptions(db, scope.websiteId));
  const { saveSetting, updateBlock } = useSiteMutations(scope);
  const pages = [...new Set(blocks.map((b) => b.page))];
  const t = useTranslations('site.settings');
  const help = (key: string) =>
    (SETTING_HELP as readonly string[]).includes(key)
      ? t(`help.${key as (typeof SETTING_HELP)[number]}`, { open: '"open": true' })
      : undefined;

  return (
    <Tabs defaultValue='settings' className='space-y-4'>
      <TabsList>
        <TabsTrigger value='settings'>{t('settingsTab')}</TabsTrigger>
        <TabsTrigger value='content'>{t('contentTab')}</TabsTrigger>
      </TabsList>
      <Alert>
        <Icons.info className='size-4' />
        <AlertDescription>{t('hint')}</AlertDescription>
      </Alert>
      <TabsContent value='settings' className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
        {settings.map((s) => (
          <JsonEditorCard
            key={`${s.key}-${s.updated_at}`}
            title={s.key}
            description={help(s.key)}
            badge={s.is_public ? undefined : t('private')}
            value={s.value}
            disabled={!scope.canEdit}
            saving={saveSetting.isPending}
            onSave={(value) =>
              saveSetting.mutate(
                { key: s.key, value },
                { onSuccess: () => toast.success(t('saved')) }
              )
            }
          />
        ))}
        {settings.length === 0 && (
          <p className='text-muted-foreground text-sm'>{t('noSettings')}</p>
        )}
      </TabsContent>
      <TabsContent value='content' className='space-y-6'>
        {pages.map((page) => (
          <section key={page} className='space-y-3'>
            <h2 className='text-lg font-semibold capitalize'>{page}</h2>
            <div className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
              {blocks
                .filter((b) => b.page === page)
                .map((b) => (
                  <JsonEditorCard
                    key={`${b.id}-${b.updated_at}`}
                    title={b.block_key}
                    badge={b.status === 'published' ? undefined : b.status}
                    value={b.data}
                    disabled={!scope.canEdit}
                    saving={updateBlock.isPending}
                    onSave={(data) => {
                      if (!data || typeof data !== 'object' || Array.isArray(data)) {
                        toast.error(t('mustBeObject'));
                        return;
                      }
                      updateBlock.mutate(
                        { id: b.id, patch: { data: data as Record<string, unknown> } },
                        { onSuccess: () => toast.success(t('saved')) }
                      );
                    }}
                  />
                ))}
            </div>
          </section>
        ))}
        {pages.length === 0 && <p className='text-muted-foreground text-sm'>{t('noContent')}</p>}
      </TabsContent>
    </Tabs>
  );
}

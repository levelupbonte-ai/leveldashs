'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { createClient } from '@/lib/supabase/client';
import { useSiteMutations } from '../../api/mutations';
import { settingsQueryOptions } from '../../api/queries';
import { JsonEditorCard } from '../json-editor-card';
import { useSiteScope } from '../use-site-scope';

/**
 * Developers only: the website settings as raw JSON, for keys or shapes the
 * friendly form of the Settings page does not cover.
 */
export function RawSettings() {
  const scope = useSiteScope();
  const t = useTranslations('site.settings');
  const { data: settings, isPending } = useQuery(
    settingsQueryOptions(createClient(), scope.websiteId)
  );
  const { saveSetting } = useSiteMutations(scope);
  if (isPending || !settings) return <Skeleton className='h-48 w-full' />;
  return (
    <div className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
      {settings.map((s) => (
        <JsonEditorCard
          key={`${s.key}-${s.updated_at}`}
          title={s.key}
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
      {settings.length === 0 && <p className='text-muted-foreground text-sm'>{t('noSettings')}</p>}
    </div>
  );
}

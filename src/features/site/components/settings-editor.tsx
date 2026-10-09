'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Icons } from '@/components/icons';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { createClient } from '@/lib/supabase/client';
import { useSuspenseQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useSiteMutations } from '../api/mutations';
import { blocksQueryOptions, settingsQueryOptions } from '../api/queries';
import { JsonEditorCard } from './json-editor-card';
import { useSiteScope } from './use-site-scope';

const SETTING_HELP: Record<string, string> = {
  contact: 'Téléphones, adresse et lien Google Maps.',
  hours: 'Horaires d’ouverture affichés sur le site.',
  booking: 'Créneaux de réservation et délai minimum.',
  waitlist: '« open »: true pour ouvrir la liste d’attente.',
  social: 'Liens vers vos réseaux sociaux.',
  branding: 'Nom, logo et couleurs.',
  seo: 'Titre et description pour Google.'
};

export function SettingsEditor() {
  const scope = useSiteScope();
  const db = createClient();
  const { data: settings } = useSuspenseQuery(settingsQueryOptions(db, scope.websiteId));
  const { data: blocks } = useSuspenseQuery(blocksQueryOptions(db, scope.websiteId));
  const { saveSetting, updateBlock } = useSiteMutations(scope);
  const pages = [...new Set(blocks.map((b) => b.page))];

  return (
    <Tabs defaultValue='settings' className='space-y-4'>
      <TabsList>
        <TabsTrigger value='settings'>Paramètres</TabsTrigger>
        <TabsTrigger value='content'>Textes des pages</TabsTrigger>
      </TabsList>
      <Alert>
        <Icons.info className='size-4' />
        <AlertDescription>
          Modifiez uniquement les valeurs entre guillemets. Les changements sont en ligne dès
          l’enregistrement.
        </AlertDescription>
      </Alert>
      <TabsContent value='settings' className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
        {settings.map((s) => (
          <JsonEditorCard
            key={`${s.key}-${s.updated_at}`}
            title={s.key}
            description={SETTING_HELP[s.key]}
            badge={s.is_public ? undefined : 'privé'}
            value={s.value}
            disabled={!scope.canEdit}
            saving={saveSetting.isPending}
            onSave={(value) =>
              saveSetting.mutate(
                { key: s.key, value },
                { onSuccess: () => toast.success('Enregistré') }
              )
            }
          />
        ))}
        {settings.length === 0 && <p className='text-muted-foreground text-sm'>Aucun paramètre.</p>}
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
                        toast.error('Le contenu doit être un objet { … }.');
                        return;
                      }
                      updateBlock.mutate(
                        { id: b.id, patch: { data: data as Record<string, unknown> } },
                        { onSuccess: () => toast.success('Enregistré') }
                      );
                    }}
                  />
                ))}
            </div>
          </section>
        ))}
        {pages.length === 0 && <p className='text-muted-foreground text-sm'>Aucun contenu.</p>}
      </TabsContent>
    </Tabs>
  );
}

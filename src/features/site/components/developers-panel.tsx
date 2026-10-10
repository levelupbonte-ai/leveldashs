'use client';

import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { createClient } from '@/lib/supabase/client';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { useSiteMutations } from '../api/mutations';
import { integrationQueryOptions, siteKeys } from '../api/queries';
import { useSiteScope } from './use-site-scope';

export const TAG_URL = 'https://levelup-ecosystem.com/sdk/v1/levelup.js';
const INSTALLED_WITHIN_MS = 7 * 24 * 3600 * 1000;

function CodeBlock({ code }: { code: string }) {
  const t = useTranslations('common');
  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast.success(t('copied'));
  };
  return (
    <div className='relative'>
      <pre className='bg-muted overflow-x-auto rounded-md p-3 pr-12 text-xs'>
        <code>{code}</code>
      </pre>
      <Button
        size='icon'
        variant='ghost'
        className='absolute top-1.5 right-1.5 size-7'
        aria-label={t('copy')}
        onClick={() => copy(code)}
      >
        <Icons.copy className='size-3.5' />
      </Button>
    </div>
  );
}

const code = (chunks: React.ReactNode) => <code>{chunks}</code>;

export function DevelopersPanel() {
  const scope = useSiteScope();
  const queryClient = useQueryClient();
  const { data: site } = useSuspenseQuery(integrationQueryOptions(createClient(), scope.websiteId));
  const { adminUpdateWebsite } = useSiteMutations(scope);
  const [origins, setOrigins] = useState(site.allowed_origins.join('\n'));
  const t = useTranslations('site.developers');
  const format = useFormatter();

  const snippet = `<script src="${TAG_URL}" data-site="${site.id}" defer></script>`;
  const lastSeen = site.tag_last_seen_at ? new Date(site.tag_last_seen_at) : null;
  const installed = !!lastSeen && Date.now() - lastSeen.getTime() < INSTALLED_WITHIN_MS;

  return (
    <div className='grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]'>
      <div className='space-y-6'>
        <Card>
          <CardHeader>
            <CardTitle>{t('installTitle')}</CardTitle>
            <CardDescription>
              {t.rich('installDescription', { code: () => <code>&lt;/body&gt;</code> })}
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-3'>
            <CodeBlock code={snippet} />
            <p className='text-muted-foreground text-xs'>
              {t.rich('siteId', { id: () => <code className='break-all'>{site.id}</code> })}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('formsTitle')}</CardTitle>
            <CardDescription>{t.rich('formsDescription', { code })}</CardDescription>
          </CardHeader>
          <CardContent>
            <CodeBlock
              code={`<form data-lu-form="contact">
  <input name="name" required>
  <input name="email" type="email" required>
  <textarea name="message"></textarea>
  <input name="_hp" style="display:none" tabindex="-1" autocomplete="off">
  <button type="submit">Send</button>
  <p data-lu-status></p>
</form>`}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('contentTitle')}</CardTitle>
            <CardDescription>{t.rich('contentDescription', { code })}</CardDescription>
          </CardHeader>
          <CardContent className='space-y-3'>
            <CodeBlock
              code={`<span data-lu="settings.contact.address"></span>
<img data-lu="settings.branding.logo_url" data-lu-attr="src" alt="Logo">
<footer><span data-lu-badge></span></footer>

<script>
  // JavaScript API (optional)
  LevelUp.ready.then((site) => console.log(site.services));
  LevelUp.submitForm('quote', { name, email, message });
</script>`}
            />
          </CardContent>
        </Card>
      </div>

      <div className='space-y-6'>
        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              {t('statusTitle')}
              {installed ? (
                <Badge>{t('active')}</Badge>
              ) : (
                <Badge variant='secondary'>{t('notDetected')}</Badge>
              )}
            </CardTitle>
            <CardDescription>
              {lastSeen
                ? t('lastSeen', {
                    date: format.dateTime(lastSeen, { dateStyle: 'medium', timeStyle: 'short' }),
                    origin: site.tag_last_seen_origin ?? '',
                    version: site.tag_version ? ` (v${site.tag_version})` : ''
                  })
                : t('neverSeen')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant='outline'
              size='sm'
              onClick={() =>
                queryClient.invalidateQueries({ queryKey: siteKeys.integration(scope.websiteId) })
              }
            >
              <Icons.check className='mr-2 size-4' /> {t('check')}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('originsTitle')}</CardTitle>
            <CardDescription>
              {t('originsDescription')}
              {!scope.isPlatformAdmin && ` ${t('originsContact')}`}
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-3'>
            {scope.isPlatformAdmin ? (
              <>
                <Textarea
                  rows={4}
                  className='font-mono text-xs'
                  value={origins}
                  onChange={(e) => setOrigins(e.target.value)}
                  placeholder='https://example.com'
                />
                <Button
                  size='sm'
                  disabled={adminUpdateWebsite.isPending}
                  onClick={() =>
                    adminUpdateWebsite.mutate(
                      {
                        allowedOrigins: origins
                          .split(/[\s,]+/)
                          .map((o) => o.trim())
                          .filter(Boolean)
                      },
                      { onSuccess: () => toast.success(t('originsSaved')) }
                    )
                  }
                >
                  {t('save')}
                </Button>
              </>
            ) : site.allowed_origins.length ? (
              <ul className='space-y-1 font-mono text-xs'>
                {site.allowed_origins.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
            ) : (
              <p className='text-muted-foreground text-sm'>{t('allOrigins')}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('serverKeysTitle')}</CardTitle>
            <CardDescription>{t('serverKeysDescription')}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}

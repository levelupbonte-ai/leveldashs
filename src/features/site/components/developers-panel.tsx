'use client';

import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { createClient } from '@/lib/supabase/client';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { useSiteMutations } from '../api/mutations';
import { integrationQueryOptions, siteKeys } from '../api/queries';
import { useSiteScope } from './use-site-scope';

export const TAG_URL = 'https://levelup-ecosystem.com/sdk/v1/levelup.js';
const INSTALLED_WITHIN_MS = 7 * 24 * 3600 * 1000;

async function copy(text: string) {
  await navigator.clipboard.writeText(text);
  toast.success('Copié');
}

function CodeBlock({ code }: { code: string }) {
  return (
    <div className='relative'>
      <pre className='bg-muted overflow-x-auto rounded-md p-3 pr-12 text-xs'>
        <code>{code}</code>
      </pre>
      <Button
        size='icon'
        variant='ghost'
        className='absolute top-1.5 right-1.5 size-7'
        aria-label='Copier'
        onClick={() => copy(code)}
      >
        <Icons.copy className='size-3.5' />
      </Button>
    </div>
  );
}

export function DevelopersPanel() {
  const scope = useSiteScope();
  const queryClient = useQueryClient();
  const { data: site } = useSuspenseQuery(integrationQueryOptions(createClient(), scope.websiteId));
  const { adminUpdateWebsite } = useSiteMutations(scope);
  const [origins, setOrigins] = useState(site.allowed_origins.join('\n'));

  const snippet = `<script src="${TAG_URL}" data-site="${site.id}" defer></script>`;
  const lastSeen = site.tag_last_seen_at ? new Date(site.tag_last_seen_at) : null;
  const installed = !!lastSeen && Date.now() - lastSeen.getTime() < INSTALLED_WITHIN_MS;

  return (
    <div className='grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]'>
      <div className='space-y-6'>
        <Card>
          <CardHeader>
            <CardTitle>1. Installer le tag LevelUp</CardTitle>
            <CardDescription>
              Collez cette ligne une seule fois, juste avant <code>&lt;/body&gt;</code>, sur toutes
              les pages du site (WordPress, Wix, Shopify, Webflow : champ « code personnalisé »).
              Ensuite, SEO, contenus et formulaires se gèrent d’ici.
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-3'>
            <CodeBlock code={snippet} />
            <p className='text-muted-foreground text-xs'>
              Identifiant public du site : <code className='break-all'>{site.id}</code>. Il n’est
              pas secret : il ne donne accès qu’au contenu déjà public et ne fonctionne que sur les
              domaines autorisés.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2. Formulaires</CardTitle>
            <CardDescription>
              Ajoutez <code>data-lu-form</code> à un formulaire existant : les demandes arrivent
              dans « Demandes ». Types : contact, quote, newsletter, vip_signup, registration.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CodeBlock
              code={`<form data-lu-form="contact">
  <input name="name" required>
  <input name="email" type="email" required>
  <textarea name="message"></textarea>
  <input name="_hp" style="display:none" tabindex="-1" autocomplete="off">
  <button type="submit">Envoyer</button>
  <p data-lu-status></p>
</form>`}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>3. Contenus et badge</CardTitle>
            <CardDescription>
              Un élément avec <code>data-lu</code> affiche une valeur gérée dans le tableau de bord
              (texte uniquement). <code>data-lu-badge</code> affiche le crédit « Built by LevelUp ».
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-3'>
            <CodeBlock
              code={`<span data-lu="settings.contact.address"></span>
<img data-lu="settings.branding.logo_url" data-lu-attr="src" alt="Logo">
<footer><span data-lu-badge></span></footer>

<script>
  // API JavaScript (optionnelle)
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
              État de l’installation
              {installed ? <Badge>Actif</Badge> : <Badge variant='secondary'>Non détecté</Badge>}
            </CardTitle>
            <CardDescription>
              {lastSeen
                ? `Dernière visite détectée le ${lastSeen.toLocaleString('fr-FR')} sur ${site.tag_last_seen_origin}${site.tag_version ? ` (v${site.tag_version})` : ''}.`
                : 'Aucune visite détectée pour le moment. Ouvrez votre site après l’installation, puis actualisez cette page.'}
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
              <Icons.check className='mr-2 size-4' /> Vérifier
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Domaines autorisés</CardTitle>
            <CardDescription>
              Seuls ces domaines peuvent envoyer des formulaires, réservations et inscriptions pour
              ce site.{!scope.isPlatformAdmin && ' Contactez LevelUp pour les modifier.'}
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
                      { onSuccess: () => toast.success('Domaines enregistrés') }
                    )
                  }
                >
                  Enregistrer
                </Button>
              </>
            ) : site.allowed_origins.length ? (
              <ul className='space-y-1 font-mono text-xs'>
                {site.allowed_origins.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
            ) : (
              <p className='text-muted-foreground text-sm'>Tous les domaines (non restreint).</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Clés serveur</CardTitle>
            <CardDescription>
              Pour connecter un back-office ou une application à LevelUp côté serveur, demandez une
              clé secrète à LevelUp. Elle ne doit jamais apparaître dans le code d’une page web.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}

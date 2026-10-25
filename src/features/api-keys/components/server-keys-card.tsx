'use client';

import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';
import { Icons } from '@/components/icons';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { FieldGroup } from '@/components/ui/field';
import { useErrorMessage } from '@/hooks/use-error-message';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import { useFields } from '@/lib/validation/use-fields';
import { useSiteScope } from '@/features/site/components/use-site-scope';
import { apiKeyKeys, apiKeysQueryOptions } from '../api/queries';
import { createApiKey, revokeApiKey } from '../api/service';
import {
  KEY_SCOPES,
  type CreatedApiKey,
  type KeyMode,
  type KeyScope,
  type SiteApiKey
} from '../api/types';

/**
 * Server keys of the website (owners and admins). A key authenticates the
 * website's own server to LevelUp (payments, events): it is shown once,
 * only its hash is stored, and it belongs in a server environment variable.
 */
export function ServerKeysCard() {
  const scope = useSiteScope();
  const { data: keys } = useSuspenseQuery(apiKeysQueryOptions(createClient(), scope.websiteId));
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const [revoking, setRevoking] = useState<SiteApiKey | null>(null);
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const t = useTranslations('insights.keys');
  const format = useFormatter();

  const revoke = useMutation({
    mutationFn: (id: string) => revokeApiKey(createClient(), id),
    onSuccess: () => {
      toast.success(t('revoked'));
      void queryClient.invalidateQueries({ queryKey: apiKeyKeys.all(scope.websiteId) });
    },
    onError: (error) => toast.error(errorMessage(error))
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <Icons.key className='size-4' aria-hidden /> {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        {!scope.canAdmin ? (
          <p className='text-muted-foreground text-sm'>{t('adminOnly')}</p>
        ) : (
          <>
            <p className='bg-muted rounded-md p-2 text-xs'>{t('serverOnly')}</p>
            {keys.length === 0 ? (
              <p className='text-muted-foreground text-sm'>{t('none')}</p>
            ) : (
              <ul className='divide-y text-sm'>
                {keys.map((k) => (
                  <li key={k.id} className='flex items-start justify-between gap-3 py-2'>
                    <div className='min-w-0'>
                      <p className='flex flex-wrap items-center gap-2 font-medium'>
                        <span className='truncate'>{k.name}</span>
                        <Badge variant={k.prefix === 'lu_live_' ? 'default' : 'secondary'}>
                          {k.prefix === 'lu_live_' ? t('live') : t('test')}
                        </Badge>
                        {k.revoked_at && <Badge variant='outline'>{t('revokedBadge')}</Badge>}
                      </p>
                      <p className='text-muted-foreground font-mono text-xs'>
                        {k.prefix}…{k.key_hint} · {k.scopes.map((s) => t(`scopes.${s}`)).join(', ')}
                      </p>
                      <p className='text-muted-foreground text-xs'>
                        {k.last_used_at
                          ? t('lastUsed', { date: format.relativeTime(new Date(k.last_used_at)) })
                          : t('neverUsed')}
                      </p>
                    </div>
                    {!k.revoked_at && (
                      <Button
                        size='sm'
                        variant='ghost'
                        disabled={revoke.isPending}
                        onClick={() => setRevoking(k)}
                      >
                        {t('revoke')}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <Button size='sm' onClick={() => setCreating(true)}>
              <Icons.add className='mr-2 size-4' /> {t('create')}
            </Button>
          </>
        )}
      </CardContent>

      <CreateKeyDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(key) => {
          setCreating(false);
          setCreated(key);
          void queryClient.invalidateQueries({ queryKey: apiKeyKeys.all(scope.websiteId) });
        }}
      />
      <ShowKeyDialog created={created} onClose={() => setCreated(null)} />

      <AlertDialog open={!!revoking} onOpenChange={(open) => !open && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('revokeTitle', { name: revoking?.name ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>{t('revokeDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (revoking) revoke.mutate(revoking.id);
                setRevoking(null);
              }}
            >
              {t('revoke')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function CreateKeyDialog({
  open,
  onOpenChange,
  onCreated
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (key: CreatedApiKey) => void;
}) {
  const scope = useSiteScope();
  const t = useTranslations('insights.keys');
  const tv = useTranslations('validation');
  const f = useFields();
  const errorMessage = useErrorMessage();
  const schema = useMemo(
    () =>
      z.object({
        name: f.text(80, { min: 1 }),
        mode: z.enum(['live', 'test']),
        scopes: z.array(z.enum(KEY_SCOPES)).min(1, { message: tv('required') })
      }),
    [f, tv]
  );
  const form = useAppForm({
    defaultValues: { name: '', mode: 'live' as KeyMode, scopes: ['payments:write'] as KeyScope[] },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      try {
        const parsed = schema.parse(value);
        onCreated(await createApiKey(createClient(), scope.websiteId, parsed));
        form.reset();
      } catch (error) {
        toast.error(errorMessage(error));
      }
    }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('createTitle')}</DialogTitle>
          <DialogDescription>{t('createDescription')}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
          className='space-y-4'
        >
          <FieldGroup>
            <form.AppField
              name='name'
              children={(field) => (
                <field.TextField
                  label={t('name')}
                  placeholder={t('namePlaceholder')}
                  maxLength={80}
                />
              )}
            />
            <form.AppField
              name='mode'
              children={(field) => (
                <field.RadioGroupField
                  label={t('mode')}
                  options={[
                    { value: 'live', label: t('modeLive') },
                    { value: 'test', label: t('modeTest') }
                  ]}
                />
              )}
            />
            <form.AppField
              name='scopes'
              children={(field) => (
                <field.CheckboxGroupField
                  label={t('scopesLabel')}
                  options={KEY_SCOPES.map((s) => ({ value: s, label: t(`scopes.${s}`) }))}
                />
              )}
            />
          </FieldGroup>
          <DialogFooter>
            <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <form.AppForm>
              <form.SubmitButton>{t('create')}</form.SubmitButton>
            </form.AppForm>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ShowKeyDialog({
  created,
  onClose
}: {
  created: CreatedApiKey | null;
  onClose: () => void;
}) {
  const t = useTranslations('insights.keys');
  const tc = useTranslations('common');
  const [copied, setCopied] = useState(false);
  return (
    <Dialog
      open={!!created}
      onOpenChange={(open) => {
        if (!open) {
          setCopied(false);
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('createdTitle')}</DialogTitle>
          <DialogDescription>{t('createdDescription')}</DialogDescription>
        </DialogHeader>
        {created && (
          <div className='space-y-3'>
            <div className='bg-muted flex items-center gap-2 rounded-md p-2'>
              <code className='min-w-0 flex-1 text-xs break-all'>{created.key}</code>
              <Button
                size='icon'
                variant='ghost'
                aria-label={tc('copy')}
                onClick={async () => {
                  await navigator.clipboard.writeText(created.key);
                  setCopied(true);
                  toast.success(tc('copied'));
                }}
              >
                {copied ? <Icons.check className='size-4' /> : <Icons.copy className='size-4' />}
              </Button>
            </div>
            <p className='text-sm'>{t('envHint')}</p>
            <pre className='bg-muted overflow-x-auto rounded-md p-2 text-xs'>
              LEVELUP_SITE_KEY=…
            </pre>
            <p className='text-muted-foreground text-xs'>{t('onceWarning')}</p>
          </div>
        )}
        <DialogFooter>
          <Button onClick={onClose}>{t('done')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

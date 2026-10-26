'use client';

import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';
import { Icons } from '@/components/icons';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';
import { FieldGroup } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { LoadingButton } from '@/components/ui/loading-button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { useNow } from '@/features/insights/lib/use-now';
import { CodeBlock, CopyButton } from '@/features/site/components/developers/code-block';
import { useSiteScope } from '@/features/site/components/use-site-scope';
import { useErrorMessage } from '@/hooks/use-error-message';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { useFields } from '@/lib/validation/use-fields';
import { apiKeyKeys, apiKeysQueryOptions } from '../api/queries';
import { createApiKey, revokeApiKey } from '../api/service';
import {
  KEY_SCOPES,
  type CreatedApiKey,
  type KeyMode,
  type KeyScope,
  type SiteApiKey
} from '../api/types';

const code = (chunks: React.ReactNode) => (
  <code className='bg-muted rounded px-1 py-0.5 font-mono text-[0.85em]'>{chunks}</code>
);

/**
 * Server keys of the website (owners and admins). A key authenticates the
 * website's own server to LevelUp (payments, events): it is shown once, only
 * its hash is stored, and it belongs in a server environment variable.
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
  const active = keys.filter((k) => !k.revoked_at).length;

  const revoke = useMutation({
    mutationFn: (id: string) => revokeApiKey(createClient(), id),
    onSuccess: () => {
      toast.success(t('revoked'));
      setRevoking(null);
      void queryClient.invalidateQueries({ queryKey: apiKeyKeys.all(scope.websiteId) });
    },
    onError: (error) => toast.error(errorMessage(error))
  });

  if (!scope.canAdmin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <Icons.lock className='size-4' aria-hidden /> {t('title')}
          </CardTitle>
          <CardDescription>{t('adminOnly')}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className='gap-3 sm:flex sm:flex-row sm:items-start sm:justify-between'>
        <div className='space-y-1.5'>
          <CardTitle className='flex items-center gap-2'>
            <Icons.key className='size-4' aria-hidden /> {t('title')}
          </CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </div>
        <Button
          className='w-full shrink-0 sm:w-auto'
          onClick={() => setCreating(true)}
          disabled={active >= 10}
        >
          <Icons.add className='size-4' aria-hidden /> {t('create')}
        </Button>
      </CardHeader>
      <CardContent className='space-y-4'>
        <div className='flex gap-2 rounded-lg border border-amber-600/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:border-amber-400/30 dark:text-amber-200'>
          <Icons.shield className='mt-0.5 size-4 shrink-0' aria-hidden />
          <p>{t.rich('serverOnly', { code })}</p>
        </div>

        {keys.length === 0 ? (
          <Empty className='border'>
            <EmptyHeader>
              <EmptyMedia variant='icon'>
                <Icons.key aria-hidden />
              </EmptyMedia>
              <EmptyTitle>{t('none')}</EmptyTitle>
              <EmptyDescription>{t('noneDescription')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <KeysList keys={keys} onRevoke={setRevoking} />
        )}
        <p className='text-muted-foreground text-xs'>{t('limits', { active })}</p>
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

      <AlertDialog
        open={!!revoking}
        onOpenChange={(open) => !open && !revoke.isPending && setRevoking(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className='bg-destructive/10 text-destructive'>
              <Icons.ban aria-hidden />
            </AlertDialogMedia>
            <AlertDialogTitle>{t('revokeTitle', { name: revoking?.name ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>{t('revokeDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoke.isPending}>{t('cancel')}</AlertDialogCancel>
            <LoadingButton
              variant='destructive'
              loading={revoke.isPending}
              onClick={() => revoking && revoke.mutate(revoking.id)}
            >
              {t('revoke')}
            </LoadingButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function useKeyText() {
  const t = useTranslations('insights.keys');
  const format = useFormatter();
  const now = useNow();
  return {
    masked: (k: SiteApiKey) => `${k.prefix}…${k.key_hint}`,
    scopes: (k: SiteApiKey) => k.scopes.map((s) => t(`scopes.${s}`)).join(', '),
    date: (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium' }),
    lastUsed: (k: SiteApiKey) =>
      k.last_used_at ? format.relativeTime(new Date(k.last_used_at), now) : t('neverUsed'),
    by: (k: SiteApiKey) => (k.created_by_name ? t('createdBy', { name: k.created_by_name }) : null)
  };
}

function KeyStatus({ k }: { k: SiteApiKey }) {
  const t = useTranslations('insights.keys');
  return (
    <div className='flex flex-wrap gap-1.5'>
      <Badge variant={k.prefix === 'lu_live_' ? 'default' : 'secondary'}>
        {k.prefix === 'lu_live_' ? t('live') : t('test')}
      </Badge>
      {k.revoked_at ? (
        <Badge variant='outline' className='text-muted-foreground'>
          {t('revokedBadge')}
        </Badge>
      ) : (
        <Badge
          variant='outline'
          className='border-emerald-600/30 text-emerald-700 dark:border-emerald-400/30 dark:text-emerald-300'
        >
          {t('active')}
        </Badge>
      )}
    </div>
  );
}

function KeysList({ keys, onRevoke }: { keys: SiteApiKey[]; onRevoke: (k: SiteApiKey) => void }) {
  const t = useTranslations('insights.keys');
  const text = useKeyText();
  return (
    <>
      {/* Phones: one card per key */}
      <ul className='space-y-3 md:hidden'>
        {keys.map((k) => (
          <li key={k.id} className={cn('rounded-lg border p-3', k.revoked_at && 'opacity-60')}>
            <div className='flex items-start justify-between gap-2'>
              <div className='min-w-0'>
                <p className='truncate font-medium'>{k.name}</p>
                <p className='text-muted-foreground font-mono text-xs'>{text.masked(k)}</p>
              </div>
              <KeyStatus k={k} />
            </div>
            <dl className='text-muted-foreground mt-3 grid grid-cols-2 gap-2 text-xs'>
              <div>
                <dt className='font-medium'>{t('columns.scope')}</dt>
                <dd>{text.scopes(k)}</dd>
              </div>
              <div>
                <dt className='font-medium'>{t('columns.lastUsed')}</dt>
                <dd>{text.lastUsed(k)}</dd>
              </div>
              <div className='col-span-2'>
                <dt className='font-medium'>{t('columns.created')}</dt>
                <dd>
                  {text.date(k.created_at)}
                  {text.by(k) && ` · ${text.by(k)}`}
                </dd>
              </div>
            </dl>
            {!k.revoked_at && (
              <Button
                size='sm'
                variant='destructive'
                className='mt-3 w-full'
                onClick={() => onRevoke(k)}
              >
                {t('revoke')}
              </Button>
            )}
          </li>
        ))}
      </ul>

      {/* Tablets and up: table */}
      <div className='hidden overflow-hidden rounded-lg border md:block'>
        <Table>
          <TableHeader>
            <TableRow className='bg-muted/50 hover:bg-muted/50'>
              <TableHead>{t('columns.name')}</TableHead>
              <TableHead>{t('columns.scope')}</TableHead>
              <TableHead>{t('columns.created')}</TableHead>
              <TableHead>{t('columns.lastUsed')}</TableHead>
              <TableHead>{t('columns.status')}</TableHead>
              <TableHead className='w-0'>
                <span className='sr-only'>{t('columns.actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.map((k) => (
              <TableRow key={k.id} className={cn(k.revoked_at && 'opacity-60')}>
                <TableCell className='max-w-56'>
                  <p className='truncate font-medium'>{k.name}</p>
                  <p className='text-muted-foreground font-mono text-xs'>{text.masked(k)}</p>
                </TableCell>
                <TableCell className='text-muted-foreground text-xs'>{text.scopes(k)}</TableCell>
                <TableCell className='text-xs'>
                  <p>{text.date(k.created_at)}</p>
                  {text.by(k) && <p className='text-muted-foreground'>{text.by(k)}</p>}
                </TableCell>
                <TableCell className='text-muted-foreground text-xs'>{text.lastUsed(k)}</TableCell>
                <TableCell>
                  <KeyStatus k={k} />
                </TableCell>
                <TableCell className='text-right'>
                  {!k.revoked_at && (
                    <Button
                      size='sm'
                      variant='ghost'
                      className='text-destructive hover:text-destructive'
                      onClick={() => onRevoke(k)}
                    >
                      {t('revoke')}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
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

/** Shows the new key once; it can only be closed after "I've stored it safely". */
function ShowKeyDialog({
  created,
  onClose
}: {
  created: CreatedApiKey | null;
  onClose: () => void;
}) {
  const t = useTranslations('insights.keys');
  const [stored, setStored] = useState(false);
  const close = () => {
    setStored(false);
    onClose();
  };
  return (
    <Dialog open={!!created} onOpenChange={(open) => !open && stored && close()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t('createdTitle')}</DialogTitle>
          <DialogDescription>{t('createdDescription')}</DialogDescription>
        </DialogHeader>
        {created && (
          <div className='min-w-0 space-y-4'>
            <div className='bg-muted/60 flex items-center gap-1 rounded-md border pl-3'>
              <code className='min-w-0 flex-1 py-2 font-mono text-xs break-all'>{created.key}</code>
              <CopyButton value={created.key} />
            </div>
            <div className='space-y-1.5'>
              <p className='text-sm'>{t('envHint')}</p>
              <CodeBlock code={`LEVELUP_SITE_KEY=${created.key}`} label='.env' />
            </div>
            <p className='text-muted-foreground text-xs'>{t('onceWarning')}</p>
            <div className='flex items-start gap-2 rounded-lg border p-3'>
              <Checkbox
                id='key-stored'
                checked={stored}
                onCheckedChange={(checked) => setStored(checked === true)}
              />
              <Label htmlFor='key-stored' className='text-sm leading-snug font-normal'>
                {t('storedConfirm')}
              </Label>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button disabled={!stored} onClick={close}>
            {t('done')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

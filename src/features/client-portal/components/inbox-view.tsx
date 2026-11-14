'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useErrorMessage } from '@/hooks/use-error-message';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { useFields } from '@/lib/validation/use-fields';
import { useSiteScope } from '@/features/site/components/use-site-scope';
import { portalInboxQueryOptions, portalKeys } from '../api/queries';
import { archivePortalConversation, replyToManyPortalCustomers } from '../api/service';
import type { InboxFolder, PortalInboxEntry } from '../api/types';
import { useNudgeEmails } from './use-nudge-emails';

const FOLDERS: InboxFolder[] = ['unread', 'all', 'read', 'drafts', 'archived'];

/** Which folder a conversation belongs to (archived ones only in Archived). */
export function inFolder(c: PortalInboxEntry, folder: InboxFolder): boolean {
  if (folder === 'archived') return c.archived;
  if (c.archived) return false;
  if (folder === 'unread') return c.unread > 0;
  if (folder === 'read') return c.messages > 0 && c.unread === 0;
  if (folder === 'drafts') return !!c.draft;
  return true;
}

/** Smart groups: same destination, same project, or a dossier to redo. */
type Group = { key: string; label: string; ids: string[] };

/** Country name in the dashboard language ("US" → "États-Unis"). */
function regionNamer(locale: string): (code: string) => string {
  try {
    const names = new Intl.DisplayNames([locale], { type: 'region' });
    return (code) => names.of(code) ?? code;
  } catch {
    return (code) => code;
  }
}

function initials(c: PortalInboxEntry) {
  const source = c.name || c.email;
  return source
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

/**
 * The team's inbox for the members of the client portal: folders (unread,
 * all, read, drafts, archived), smart groups (destination country, project,
 * dossier to redo), and one message to several members at once.
 */
export function InboxView({
  folder,
  onFolderChange,
  onOpen
}: {
  folder: InboxFolder;
  onFolderChange: (folder: InboxFolder) => void;
  onOpen: (customer: PortalInboxEntry) => void;
}) {
  const scope = useSiteScope();
  const t = useTranslations('clientPortal.inbox');
  const locale = useLocale();
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const { data, isPending } = useQuery(portalInboxQueryOptions(createClient(), scope.websiteId));
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState<string>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [composeOpen, setComposeOpen] = useState(false);
  const [preset, setPreset] = useState<'redo' | null>(null);

  const entries = useMemo(() => data ?? [], [data]);
  const regionName = useMemo(() => regionNamer(locale), [locale]);
  const [now] = useState(() => new Date());

  const groups = useMemo<Group[]>(() => {
    const byCountry = new Map<string, string[]>();
    const byProject = new Map<string, string[]>();
    const redo: string[] = [];
    for (const c of entries) {
      if (c.status !== 'active') continue;
      if (!c.has_dossier) redo.push(c.id);
      if (c.country) byCountry.set(c.country, [...(byCountry.get(c.country) ?? []), c.id]);
      if (c.country && c.purpose) {
        const key = `${c.country}|${c.purpose}`;
        byProject.set(key, [...(byProject.get(key) ?? []), c.id]);
      }
    }
    const out: Group[] = [];
    if (redo.length) out.push({ key: 'redo', label: t('groups.redo'), ids: redo });
    for (const [code, ids] of [...byCountry].toSorted((a, b) => b[1].length - a[1].length)) {
      out.push({ key: `country:${code}`, label: regionName(code), ids });
    }
    // Same destination and same project, when at least two members share it.
    for (const [key, ids] of byProject) {
      if (ids.length < 2) continue;
      const [code, purpose] = key.split('|');
      out.push({ key: `project:${key}`, label: `${regionName(code)} · ${purpose}`, ids });
    }
    return out;
  }, [entries, regionName, t]);

  const groupIds = useMemo(
    () => (group === 'all' ? null : new Set(groups.find((g) => g.key === group)?.ids ?? [])),
    [group, groups]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((c) => {
      // A group shows its members whatever the folder (to write to all of them).
      if (groupIds ? !groupIds.has(c.id) : !inFolder(c, folder)) return false;
      if (!q) return true;
      return [c.name, c.email, c.country ? regionName(c.country) : '', c.last?.body, c.draft]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [entries, folder, groupIds, search, regionName]);

  const counts = useMemo(
    () => Object.fromEntries(FOLDERS.map((f) => [f, entries.filter((c) => inFolder(c, f)).length])),
    [entries]
  );

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectable = visible.filter((c) => c.status === 'active');
  const allSelected = selectable.length > 0 && selectable.every((c) => selected.has(c.id));

  const archive = async (c: PortalInboxEntry, archived: boolean) => {
    try {
      await archivePortalConversation(createClient(), c.id, archived);
      void queryClient.invalidateQueries({ queryKey: portalKeys.inbox(scope.websiteId) });
      toast.success(archived ? t('archived') : t('unarchived'));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className='space-y-3'>
      <div
        className='-mx-1 flex gap-1 overflow-x-auto px-1 pb-1'
        role='tablist'
        aria-label={t('folders')}
      >
        {FOLDERS.map((f) => (
          <button
            key={f}
            type='button'
            role='tab'
            aria-selected={group === 'all' && folder === f}
            onClick={() => {
              setGroup('all');
              onFolderChange(f);
            }}
            className={cn(
              'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors',
              group === 'all' && folder === f
                ? 'bg-foreground text-background border-foreground'
                : 'hover:bg-accent'
            )}
          >
            {t(`folder.${f}`)}
            {counts[f] > 0 && (
              <span
                className={cn(
                  'rounded-full px-1.5 text-xs tabular-nums',
                  f === 'unread' && !(group === 'all' && folder === f)
                    ? 'bg-primary text-primary-foreground'
                    : 'opacity-70'
                )}
              >
                {counts[f]}
              </span>
            )}
          </button>
        ))}
      </div>

      {groups.length > 0 && (
        <div className='space-y-1.5'>
          <p className='text-muted-foreground text-xs font-medium'>{t('groups.title')}</p>
          <div className='-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1'>
            {groups.map((g) => (
              <button
                key={g.key}
                type='button'
                aria-pressed={group === g.key}
                onClick={() => {
                  const next = group === g.key ? 'all' : g.key;
                  setGroup(next);
                  setSelected(next === 'all' ? new Set() : new Set(g.ids));
                }}
                className={cn(
                  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors',
                  group === g.key ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent',
                  g.key === 'redo' &&
                    group !== g.key &&
                    'border-amber-500/40 text-amber-700 dark:text-amber-400'
                )}
              >
                {g.key === 'redo' ? (
                  <Icons.warning className='size-3.5' aria-hidden />
                ) : g.key.startsWith('country') ? (
                  <Icons.world className='size-3.5' aria-hidden />
                ) : (
                  <Icons.teams className='size-3.5' aria-hidden />
                )}
                {g.label}
                <span className='opacity-70'>{g.ids.length}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className='flex flex-wrap items-center gap-2'>
        <div className='relative min-w-0 flex-1'>
          <Icons.search
            className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2'
            aria-hidden
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('search')}
            aria-label={t('search')}
            className='pl-8'
          />
        </div>
        <Button
          variant='outline'
          size='sm'
          className='h-9'
          onClick={() =>
            setSelected(allSelected ? new Set() : new Set(selectable.map((c) => c.id)))
          }
          disabled={!selectable.length}
        >
          <Icons.listCheck aria-hidden />
          {allSelected ? t('selectNone') : t('selectAll')}
        </Button>
      </div>

      {isPending && (
        <div className='space-y-2'>
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className='h-16 w-full' />
          ))}
        </div>
      )}

      {!isPending && visible.length === 0 && (
        <div className='text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm'>
          {t(`empty.${group === 'all' ? folder : 'group'}`)}
        </div>
      )}

      <ul className='divide-y rounded-lg border'>
        {visible.map((c) => {
          const checked = selected.has(c.id);
          return (
            <li key={c.id} className={cn('flex items-start gap-3 p-3', checked && 'bg-accent/50')}>
              <Checkbox
                className='mt-2.5'
                checked={checked}
                disabled={c.status !== 'active'}
                onCheckedChange={() => toggle(c.id)}
                aria-label={t('select', { name: c.name || c.email })}
              />
              <button
                type='button'
                onClick={() => onOpen(c)}
                className='flex min-w-0 flex-1 items-start gap-3 text-left'
              >
                <span
                  className={cn(
                    'grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold',
                    c.unread ? 'bg-primary text-primary-foreground' : 'bg-muted'
                  )}
                  aria-hidden
                >
                  {initials(c)}
                </span>
                <span className='min-w-0 flex-1'>
                  <span className='flex items-center gap-2'>
                    <span
                      className={cn('truncate text-sm', c.unread ? 'font-semibold' : 'font-medium')}
                    >
                      {c.name || c.email}
                    </span>
                    {c.country && (
                      <span className='text-muted-foreground shrink-0 text-xs'>
                        {regionName(c.country)}
                      </span>
                    )}
                    {c.last && (
                      <span className='text-muted-foreground ml-auto shrink-0 text-xs'>
                        {format.relativeTime(new Date(c.last.at), now)}
                      </span>
                    )}
                  </span>
                  <span className='text-muted-foreground mt-0.5 line-clamp-1 block text-sm'>
                    {c.draft ? (
                      <>
                        <span className='text-destructive font-medium'>{t('draft')} </span>
                        {c.draft}
                      </>
                    ) : c.last ? (
                      <>
                        {c.last.sender === 'owner' && <span>{t('you')} </span>}
                        {c.last.body}
                      </>
                    ) : (
                      t('noMessages')
                    )}
                  </span>
                  <span className='mt-1 flex flex-wrap gap-1.5'>
                    {c.unread > 0 && <Badge>{t('unread', { count: c.unread })}</Badge>}
                    {!c.has_dossier && c.status === 'active' && (
                      <Badge
                        variant='outline'
                        className='border-amber-500/40 text-amber-700 dark:text-amber-400'
                      >
                        {t('noDossier')}
                      </Badge>
                    )}
                    {c.status !== 'active' && <Badge variant='secondary'>{t('revoked')}</Badge>}
                  </span>
                </span>
              </button>
              <Button
                variant='ghost'
                size='icon'
                className='size-8 shrink-0'
                onClick={() => void archive(c, !c.archived)}
                aria-label={c.archived ? t('unarchive') : t('archive')}
                title={c.archived ? t('unarchive') : t('archive')}
              >
                <Icons.archive aria-hidden />
              </Button>
            </li>
          );
        })}
      </ul>

      {selected.size > 0 && (
        <div className='bg-background/95 sticky bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-10 flex flex-wrap items-center gap-2 rounded-xl border p-3 shadow-lg backdrop-blur'>
          <p className='text-sm font-medium'>{t('selected', { count: selected.size })}</p>
          <div className='ml-auto flex gap-2'>
            <Button variant='ghost' size='sm' onClick={() => setSelected(new Set())}>
              {t('clear')}
            </Button>
            <Button
              size='sm'
              onClick={() => {
                setPreset(group === 'redo' ? 'redo' : null);
                setComposeOpen(true);
              }}
            >
              <Icons.send aria-hidden />
              {t('writeTo', { count: selected.size })}
            </Button>
          </div>
        </div>
      )}

      <GroupMessageDialog
        open={composeOpen}
        onOpenChange={setComposeOpen}
        recipients={entries.filter((c) => selected.has(c.id))}
        preset={preset}
        onSent={() => setSelected(new Set())}
      />
    </div>
  );
}

/** One message to several members: each receives it in their space (and by e-mail). */
function GroupMessageDialog({
  open,
  onOpenChange,
  recipients,
  preset,
  onSent
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipients: PortalInboxEntry[];
  preset: 'redo' | null;
  onSent: () => void;
}) {
  const scope = useSiteScope();
  const t = useTranslations('clientPortal.inbox.group');
  const f = useFields();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const nudge = useNudgeEmails();
  const site = scope.website.primaryDomain ? `https://${scope.website.primaryDomain}` : '';
  const schema = useMemo(() => z.object({ body: f.text(4000, { min: 1, multiline: true }) }), [f]);
  const form = useAppForm({
    defaultValues: { body: '' },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      try {
        const out = await replyToManyPortalCustomers(
          createClient(),
          scope.websiteId,
          recipients.map((r) => r.id),
          schema.parse(value).body
        );
        nudge();
        toast.success(t('sent', { count: out.sent }));
        form.reset();
        onSent();
        onOpenChange(false);
        void queryClient.invalidateQueries({ queryKey: portalKeys.all(scope.websiteId) });
      } catch (error) {
        toast.error(errorMessage(error));
      }
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next && preset === 'redo' && !form.getFieldValue('body')) {
          form.setFieldValue('body', t('template.redo', { site }));
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className='max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{t('title', { count: recipients.length })}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <p className='text-muted-foreground line-clamp-2 text-xs'>
          {recipients.map((r) => r.name || r.email).join(', ')}
        </p>
        <div className='flex flex-wrap gap-1.5'>
          {(['redo', 'news', 'call'] as const).map((k) => (
            <Button
              key={k}
              type='button'
              size='sm'
              variant='outline'
              className='h-7 rounded-full text-xs'
              onClick={() => form.setFieldValue('body', t(`template.${k}`, { site }))}
            >
              {t(`templateLabel.${k}`)}
            </Button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
          className='space-y-3'
        >
          <form.AppField
            name='body'
            children={(field) => (
              <field.TextareaField label={t('message')} rows={6} maxLength={4000} />
            )}
          />
          <form.AppForm>
            <form.SubmitButton>{t('send', { count: recipients.length })}</form.SubmitButton>
          </form.AppForm>
        </form>
      </DialogContent>
    </Dialog>
  );
}

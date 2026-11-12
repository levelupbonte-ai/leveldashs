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
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';
import { FieldGroup } from '@/components/ui/field';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet';
import { useErrorMessage } from '@/hooks/use-error-message';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import { useFields } from '@/lib/validation/use-fields';
import { useSiteScope } from '@/features/site/components/use-site-scope';
import { portalAssistantQueryOptions, portalKeys } from '../api/queries';
import {
  deletePortalKnowledgeNote,
  savePortalAssistantSettings,
  savePortalKnowledgeNote
} from '../api/service';
import type { PortalAssistant, PortalKnowledgeNote } from '../api/types';

/**
 * The members' AI assistant: on/off, questions per member per day, and the
 * notes it relies on first (the owner's own advice). Questions it cannot
 * settle come back as messages marked "via the assistant", with a prepared
 * reply (see the conversation sheet).
 */
export function AssistantPanel() {
  const scope = useSiteScope();
  const t = useTranslations('clientPortal.assistant');
  const format = useFormatter();
  const { data } = useSuspenseQuery(portalAssistantQueryOptions(createClient(), scope.websiteId));
  const [editing, setEditing] = useState<PortalKnowledgeNote | null | undefined>(undefined);
  const [removing, setRemoving] = useState<PortalKnowledgeNote | null>(null);
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();

  const remove = useMutation({
    mutationFn: (id: string) => deletePortalKnowledgeNote(createClient(), id),
    onSuccess: () => {
      toast.success(t('notes.deleted'));
      void queryClient.invalidateQueries({ queryKey: portalKeys.assistant(scope.websiteId) });
    },
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: () => setRemoving(null)
  });

  return (
    <div className='space-y-4'>
      <SettingsCard data={data} />

      <div className='grid gap-3 sm:grid-cols-3'>
        {(
          [
            ['today', data.questions_today],
            ['month', data.questions_month],
            ['handoffs', data.handoffs_open]
          ] as const
        ).map(([k, v]) => (
          <Card key={k} className='gap-1 py-4'>
            <CardContent className='px-4'>
              <p className='text-muted-foreground text-xs'>{t(`stats.${k}`)}</p>
              <p className='text-2xl font-semibold tabular-nums'>{v}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className='flex flex-row items-start justify-between gap-2'>
          <div className='space-y-1.5'>
            <CardTitle>{t('notes.title')}</CardTitle>
            <CardDescription>{t('notes.description')}</CardDescription>
          </div>
          {scope.canEdit && (
            <Button size='sm' onClick={() => setEditing(null)}>
              <Icons.add aria-hidden />
              {t('notes.new')}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {data.notes.length === 0 ? (
            <Empty className='border'>
              <EmptyHeader>
                <EmptyMedia variant='icon'>
                  <Icons.sparkles />
                </EmptyMedia>
                <EmptyTitle>{t('notes.emptyTitle')}</EmptyTitle>
                <EmptyDescription>{t('notes.emptyDescription')}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className='divide-y'>
              {data.notes.map((n) => (
                <li key={n.id} className='flex flex-col gap-2 py-3 sm:flex-row sm:items-start'>
                  <div className='min-w-0 flex-1'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <p className='font-medium'>{n.title}</p>
                      {!n.active && <Badge variant='secondary'>{t('notes.off')}</Badge>}
                    </div>
                    <p className='text-muted-foreground line-clamp-2 text-sm whitespace-pre-line'>
                      {n.body}
                    </p>
                    <p className='text-muted-foreground mt-1 text-xs'>
                      {t('notes.updated', {
                        date: format.dateTime(new Date(n.updated_at), { dateStyle: 'medium' })
                      })}
                    </p>
                  </div>
                  {scope.canEdit && (
                    <div className='flex gap-2'>
                      <Button size='sm' variant='outline' onClick={() => setEditing(n)}>
                        <Icons.edit aria-hidden />
                        {t('notes.edit')}
                      </Button>
                      <Button
                        size='sm'
                        variant='ghost'
                        onClick={() => setRemoving(n)}
                        aria-label={t('notes.delete', { title: n.title })}
                      >
                        <Icons.trash aria-hidden />
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className='text-muted-foreground text-xs'>{t('transparency')}</p>

      <Sheet open={editing !== undefined} onOpenChange={(open) => !open && setEditing(undefined)}>
        <SheetContent className='w-full overflow-y-auto sm:max-w-lg'>
          <SheetHeader>
            <SheetTitle>{editing ? t('notes.editTitle') : t('notes.newTitle')}</SheetTitle>
            <SheetDescription>{t('notes.sheetDescription')}</SheetDescription>
          </SheetHeader>
          {editing !== undefined && (
            <NoteForm note={editing} onDone={() => setEditing(undefined)} />
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!removing} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('notes.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('notes.deleteDescription', { title: removing?.title ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={() => removing && remove.mutate(removing.id)}
            >
              {t('notes.deleteConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SettingsCard({ data }: { data: PortalAssistant }) {
  const scope = useSiteScope();
  const t = useTranslations('clientPortal.assistant');
  const tv = useTranslations('validation');
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();

  const schema = useMemo(
    () =>
      z.object({
        enabled: z.boolean(),
        daily: z
          .string()
          .regex(/^\d{1,3}$/, tv('invalid'))
          .refine((v) => Number(v) >= 1 && Number(v) <= 200, t('dailyInvalid'))
      }),
    [t, tv]
  );

  const form = useAppForm({
    defaultValues: { enabled: data.enabled, daily: String(data.daily) },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      const v = schema.parse(value);
      try {
        await savePortalAssistantSettings(createClient(), scope.websiteId, {
          enabled: v.enabled,
          daily: Number(v.daily)
        });
        toast.success(t('saved'));
        void queryClient.invalidateQueries({ queryKey: portalKeys.assistant(scope.websiteId) });
      } catch (error) {
        toast.error(errorMessage(error));
      }
    }
  });

  return (
    <Card>
      <CardHeader>
        <div className='flex flex-wrap items-center gap-2'>
          <Icons.sparkles className='size-5' aria-hidden />
          <CardTitle>{t('title')}</CardTitle>
          <Badge variant={data.enabled ? 'default' : 'secondary'}>
            {data.enabled ? t('on') : t('off')}
          </Badge>
        </div>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className='text-muted-foreground mb-4 grid gap-2 text-sm sm:grid-cols-3'>
          {(['dossier', 'sources', 'handoff'] as const).map((k) => (
            <li key={k} className='bg-muted/50 rounded-lg p-3'>
              <span className='text-foreground font-medium'>{t(`how.${k}Title`)}</span>
              <p className='mt-1'>{t(`how.${k}Text`)}</p>
            </li>
          ))}
        </ul>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
          className='space-y-4'
        >
          <FieldGroup>
            <form.AppField
              name='enabled'
              children={(field) => (
                <field.SwitchField label={t('enabled')} description={t('enabledHint')} />
              )}
            />
            <form.AppField
              name='daily'
              children={(field) => (
                <field.TextField
                  label={t('daily')}
                  description={t('dailyHint')}
                  inputMode='numeric'
                  maxLength={3}
                  showCount={false}
                  disabled={!scope.canEdit}
                  className='max-w-32'
                />
              )}
            />
          </FieldGroup>
          {scope.canEdit && (
            <form.AppForm>
              <form.SubmitButton>{t('save')}</form.SubmitButton>
            </form.AppForm>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function NoteForm({ note, onDone }: { note: PortalKnowledgeNote | null; onDone: () => void }) {
  const scope = useSiteScope();
  const t = useTranslations('clientPortal.assistant');
  const f = useFields();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();

  const schema = useMemo(
    () =>
      z.object({
        title: f.text(160, { min: 1 }),
        body: f.text(8000, { min: 1, multiline: true }),
        active: z.boolean()
      }),
    [f]
  );

  const form = useAppForm({
    defaultValues: {
      title: note?.title ?? '',
      body: note?.body ?? '',
      active: note?.active ?? true
    },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      try {
        await savePortalKnowledgeNote(
          createClient(),
          scope.websiteId,
          note?.id ?? null,
          schema.parse(value)
        );
        toast.success(t('notes.saved'));
        void queryClient.invalidateQueries({ queryKey: portalKeys.assistant(scope.websiteId) });
        onDone();
      } catch (error) {
        toast.error(errorMessage(error));
      }
    }
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
      className='flex flex-col gap-4 px-4 pb-4'
    >
      <FieldGroup>
        <form.AppField
          name='title'
          children={(field) => (
            <field.TextField
              label={t('notes.titleLabel')}
              placeholder={t('notes.titlePlaceholder')}
              maxLength={160}
              required
            />
          )}
        />
        <form.AppField
          name='body'
          children={(field) => (
            <field.TextareaField
              label={t('notes.bodyLabel')}
              description={t('notes.bodyHint')}
              rows={10}
              maxLength={8000}
              required
            />
          )}
        />
        <form.AppField
          name='active'
          children={(field) => (
            <field.SwitchField label={t('notes.active')} description={t('notes.activeHint')} />
          )}
        />
      </FieldGroup>
      <SheetFooter className='flex-row justify-end gap-2 px-0'>
        <Button type='button' variant='outline' onClick={onDone}>
          {t('cancel')}
        </Button>
        <form.AppForm>
          <form.SubmitButton>{t('notes.save')}</form.SubmitButton>
        </form.AppForm>
      </SheetFooter>
    </form>
  );
}

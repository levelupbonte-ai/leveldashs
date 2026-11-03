'use client';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
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
import { useErrorMessage } from '@/hooks/use-error-message';
import { useSiteScope } from '@/features/site/components/use-site-scope';
import { createClient } from '@/lib/supabase/client';
import { formKeys, formsQueryOptions } from '../api/queries';
import { archiveForm } from '../api/service';
import type { SiteForm, SiteFormInput } from '../api/types';
import { STARTERS, type Starter } from '../lib/starters';
import { FormBuilder } from './form-builder';

type Editing = { input: SiteFormInput; publicId: string | null } | null;

/** Forms of the active website: list, new form from a starter, the builder. */
export function FormsManager() {
  const t = useTranslations('siteForms');
  const tStarter = useTranslations('siteForms.starters');
  const format = useFormatter();
  const scope = useSiteScope();
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const [db] = useState(createClient);
  const { data: forms } = useSuspenseQuery(formsQueryOptions(db, scope.websiteId));
  const [editing, setEditing] = useState<Editing>(null);
  const [archiving, setArchiving] = useState<SiteForm | null>(null);

  const archive = useMutation({
    mutationFn: (id: string) => archiveForm(db, id),
    onSuccess: () => {
      toast.success(t('archived'));
      setArchiving(null);
      void qc.invalidateQueries({ queryKey: formKeys.all(scope.websiteId) });
    },
    onError: (e) => toast.error(errorMessage(e, 'saveFailed'))
  });

  if (editing) {
    return (
      <FormBuilder
        key={editing.input.id ?? 'new'}
        initial={editing.input}
        publicId={editing.publicId}
        onClose={() => setEditing(null)}
        onSaved={(id, publicId) =>
          setEditing((e) => (e ? { input: { ...e.input, id }, publicId } : e))
        }
      />
    );
  }

  const start = (s: Starter) => {
    const tl = (key: string) => tStarter(`labels.${key}` as 'labels.name');
    setEditing({
      publicId: null,
      input: {
        id: null,
        name: tStarter(`${s.key}.name`),
        form_type: s.formType,
        status: 'draft',
        fields: s.fields(tl),
        settings: s.settings(tl)
      }
    });
  };

  return (
    <div className='grid gap-6'>
      {scope.canEdit && (
        <section className='grid gap-3'>
          <h2 className='text-sm font-medium'>{t('new')}</h2>
          <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
            {STARTERS.map((s) => (
              <button
                key={s.key}
                type='button'
                onClick={() => start(s)}
                className='hover:border-primary/60 hover:bg-muted/40 flex min-h-24 flex-col items-start gap-1 rounded-xl border p-4 text-left transition'
              >
                <span className='flex items-center gap-2 font-medium'>
                  <Icons.add className='size-4' aria-hidden />
                  {tStarter(`${s.key}.name`)}
                </span>
                <span className='text-muted-foreground text-sm'>{tStarter(`${s.key}.text`)}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className='grid gap-3'>
        <h2 className='text-sm font-medium'>{t('yours')}</h2>
        {forms.length === 0 ? (
          <div className='text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm'>
            {t('empty')}
          </div>
        ) : (
          <ul className='grid gap-3'>
            {forms.map((f) => (
              <li
                key={f.id}
                className='flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4'
              >
                <div className='min-w-0'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <span className='font-medium'>{f.name}</span>
                    <Badge variant={f.status === 'published' ? 'default' : 'outline'}>
                      {t(`builder.status.${f.status}`)}
                    </Badge>
                  </div>
                  <p className='text-muted-foreground mt-1 text-xs'>
                    {t('answers', { count: f.answers })}
                    {f.last_answer_at &&
                      ` · ${t('lastAnswer', { when: format.relativeTime(new Date(f.last_answer_at)) })}`}
                    {' · '}
                    {t('fieldsCount', { count: f.fields.length })}
                  </p>
                </div>
                <div className='flex flex-wrap gap-2'>
                  {f.answers > 0 && (
                    <Link
                      href='/dashboard/site/requests'
                      className='text-muted-foreground hover:text-foreground inline-flex h-9 items-center px-2 text-sm'
                    >
                      {t('seeAnswers')}
                    </Link>
                  )}
                  {f.status === 'published' && (
                    <a
                      href={`/f/${f.public_id}`}
                      target='_blank'
                      rel='noopener noreferrer'
                      className='text-muted-foreground hover:text-foreground inline-flex h-9 items-center gap-1 px-2 text-sm'
                    >
                      <Icons.externalLink className='size-4' aria-hidden />
                      {t('open')}
                    </a>
                  )}
                  <Button
                    variant='outline'
                    size='sm'
                    className='h-9'
                    onClick={() =>
                      setEditing({
                        publicId: f.public_id,
                        input: {
                          id: f.id,
                          name: f.name,
                          form_type: f.form_type,
                          status: f.status,
                          fields: f.fields,
                          settings: f.settings
                        }
                      })
                    }
                  >
                    <Icons.edit className='size-4' aria-hidden />
                    {scope.canEdit ? t('edit') : t('view')}
                  </Button>
                  {scope.canEdit && (
                    <Button
                      variant='ghost'
                      size='icon'
                      className='size-9'
                      aria-label={t('archive')}
                      onClick={() => setArchiving(f)}
                    >
                      <Icons.archive className='size-4' aria-hidden />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <AlertDialog open={!!archiving} onOpenChange={(o) => !o && setArchiving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('archiveTitle', { name: archiving?.name ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('archiveText')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={archive.isPending}
              onClick={() => archiving && archive.mutate(archiving.id)}
            >
              {t('archive')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useSiteScope } from '@/features/site/components/use-site-scope';
import { useErrorMessage } from '@/hooks/use-error-message';
import { createClient } from '@/lib/supabase/client';
import { emailKeys } from '../api/queries';
import { importContacts } from '../api/service';
import { IMPORT_MAX_ROWS, parseContactsCsv, type ParsedImport } from '../lib/csv-import';

/**
 * CSV import (owners and admins). Nothing is sent until the person ticks the
 * consent statement; the statement, who confirmed it and when are recorded
 * with the import. Existing contacts are never changed.
 */
export function ImportDialog({
  open,
  onOpenChange
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('emailCampaigns.import');
  const scope = useSiteScope();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const statement = t('statement');

  const reset = () => {
    setParsed(null);
    setFileError(null);
    setConsent(false);
  };
  const run = useMutation({
    mutationFn: () => importContacts(createClient(), scope.websiteId, parsed!.rows, statement),
    onSuccess: async (res) => {
      toast.success(t('done', { added: res.added, existing: res.existing }));
      await queryClient.invalidateQueries({ queryKey: emailKeys.all(scope.websiteId) });
      reset();
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e))
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <Field data-invalid={!!fileError}>
          <FieldLabel htmlFor='contacts-file'>{t('file')}</FieldLabel>
          <Input
            id='contacts-file'
            type='file'
            accept='.csv,text/csv'
            aria-invalid={!!fileError}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              setParsed(null);
              setFileError(null);
              if (!file) return;
              if (file.size > 2 * 1024 * 1024) return setFileError(t('tooLarge'));
              const result = parseContactsCsv(await file.text());
              if (!result.rows.length) return setFileError(t('noRows'));
              if (result.rows.length > IMPORT_MAX_ROWS)
                return setFileError(t('tooMany', { max: IMPORT_MAX_ROWS }));
              setParsed(result);
            }}
          />
          <FieldDescription>{fileError ?? t('fileHint')}</FieldDescription>
        </Field>
        {parsed && (
          <div className='bg-muted/40 rounded-lg border p-3 text-sm'>
            <p className='flex items-center gap-2 font-medium'>
              <Icons.check className='size-4 text-emerald-600' aria-hidden />
              {t('ready', { count: parsed.rows.length })}
            </p>
            {(parsed.invalid > 0 || parsed.duplicates > 0) && (
              <p className='text-muted-foreground mt-1 text-xs'>
                {t('skipped', { invalid: parsed.invalid, duplicates: parsed.duplicates })}
              </p>
            )}
          </div>
        )}
        <label
          htmlFor='import-consent'
          className='flex items-start gap-3 rounded-lg border p-3 text-sm'
        >
          <Checkbox
            id='import-consent'
            checked={consent}
            onCheckedChange={(v) => setConsent(v === true)}
            className='mt-0.5'
          />
          <span>
            <span className='font-medium'>{statement}</span>
            <span className='text-muted-foreground mt-1 block text-xs'>{t('statementHint')}</span>
          </span>
        </label>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button disabled={!parsed || !consent || run.isPending} onClick={() => run.mutate()}>
            {t('confirm', { count: parsed?.rows.length ?? 0 })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

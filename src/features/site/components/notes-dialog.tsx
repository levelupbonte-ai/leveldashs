'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { CharCounter } from '@/components/forms/char-counter';
import { Textarea } from '@/components/ui/textarea';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useFieldMessages } from '@/lib/validation/use-fields';
import { sanitizeNotes } from '../api/service';

/** Private staff notes (never shown to the customer). */
export function NotesDialog({
  open,
  initial,
  title,
  onOpenChange,
  onSave
}: {
  open: boolean;
  initial: string;
  title: string;
  onOpenChange: (open: boolean) => void;
  onSave: (notes: string | null) => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const t = useTranslations('site.content');
  const messages = useFieldMessages();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t('notesDescription')}</DialogDescription>
        </DialogHeader>
        <Textarea
          rows={5}
          maxLength={4000}
          value={value}
          aria-label={title}
          aria-invalid={!!error}
          aria-describedby='staff-notes-count'
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
        />
        <div className='flex items-start gap-3'>
          {error && <p className='text-destructive text-xs'>{error}</p>}
          <CharCounter id='staff-notes-count' count={value.length} max={4000} />
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button
            onClick={() => {
              // Same rules as the service: cleaned, 4000 characters, no HTML.
              const notes = sanitizeNotes(value);
              if (notes === undefined) {
                setError(messages.noHtml ?? null);
                return;
              }
              onSave(notes);
              onOpenChange(false);
            }}
          >
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

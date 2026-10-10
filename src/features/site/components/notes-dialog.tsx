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
import { Textarea } from '@/components/ui/textarea';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

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
  const t = useTranslations('site.content');
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
          onChange={(e) => setValue(e.target.value)}
        />
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button
            onClick={() => {
              onSave(value.trim() || null);
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

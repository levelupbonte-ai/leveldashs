'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { useErrorMessage } from '@/hooks/use-error-message';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import { useFields } from '@/lib/validation/use-fields';
import { useSiteScope } from '@/features/site/components/use-site-scope';
import { portalKeys } from '../api/queries';
import { setPortalTrial } from '../api/service';
import type { PortalCustomer } from '../api/types';

const DAY = 86400000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Extend or end one member's free offer (at most 90 days ahead). */
export function TrialDialog({
  customer,
  onOpenChange
}: {
  customer: PortalCustomer | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('clientPortal.trial');
  return (
    <Dialog open={!!customer} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>
            {t('description', { name: customer?.name || customer?.email || '' })}
          </DialogDescription>
        </DialogHeader>
        {customer && <TrialForm customer={customer} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function TrialForm({ customer, onDone }: { customer: PortalCustomer; onDone: () => void }) {
  const scope = useSiteScope();
  const t = useTranslations('clientPortal.trial');
  const tv = useTranslations('validation');
  const f = useFields();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const [{ today, max, suggested }] = useState(() => {
    const now = Date.now();
    return {
      today: isoDay(new Date(now)),
      max: isoDay(new Date(now + 89 * DAY)),
      suggested: isoDay(new Date(now + 3 * DAY))
    };
  });

  const save = async (endsAt: Date) => {
    try {
      await setPortalTrial(createClient(), customer.id, endsAt);
      toast.success(t('saved'));
      void queryClient.invalidateQueries({ queryKey: portalKeys.all(scope.websiteId) });
      onDone();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const schema = useMemo(
    () =>
      z.object({ until: f.date({ required: true }) }).superRefine((v, ctx) => {
        if (v.until < today || v.until > max) {
          ctx.addIssue({ code: 'custom', path: ['until'], message: tv('date') });
        }
      }),
    [f, tv, today, max]
  );
  const current = customer.trial_ends_at ? isoDay(new Date(customer.trial_ends_at)) : '';
  const form = useAppForm({
    defaultValues: {
      until: current && current >= today ? current : suggested
    },
    validators: { onSubmit: schema },
    // End of the chosen day, in the owner's time zone.
    onSubmit: ({ value }) => save(new Date(`${schema.parse(value).until}T23:59:00`))
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
      className='space-y-4'
    >
      <form.AppField
        name='until'
        children={(field) => (
          <field.TextField
            label={t('until')}
            description={t('untilHint')}
            type='date'
            min={today}
            max={max}
          />
        )}
      />
      <DialogFooter className='gap-2 sm:justify-between'>
        <Button type='button' variant='ghost' onClick={() => save(new Date())}>
          {t('endNow')}
        </Button>
        <form.AppForm>
          <form.SubmitButton>{t('save')}</form.SubmitButton>
        </form.AppForm>
      </DialogFooter>
    </form>
  );
}

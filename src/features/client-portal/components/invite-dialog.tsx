'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
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
import { FieldGroup } from '@/components/ui/field';
import { useErrorMessage } from '@/hooks/use-error-message';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import { useFields } from '@/lib/validation/use-fields';
import { useSiteScope } from '@/features/site/components/use-site-scope';
import { portalKeys } from '../api/queries';
import { invitePortalCustomer } from '../api/service';
import { useNudgeEmails } from './use-nudge-emails';

/** "Invite to portal": gives an e-mail address access; the website e-mails the invitation. */
export function InviteDialog({
  open,
  onOpenChange,
  offers
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  offers: { id: string; name: string | null }[];
}) {
  const scope = useSiteScope();
  const t = useTranslations('clientPortal.invite');
  const f = useFields();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const nudge = useNudgeEmails();
  const schema = useMemo(
    () =>
      z.object({
        email: f.email({ required: true }),
        name: f.text(120),
        offerId: z.string().max(100),
        locale: z.enum(['en', 'fr'])
      }),
    [f]
  );
  const form = useAppForm({
    defaultValues: { email: '', name: '', offerId: '', locale: 'en' as 'en' | 'fr' },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      try {
        const res = await invitePortalCustomer(
          createClient(),
          scope.websiteId,
          schema.parse(value)
        );
        toast.success(res.created ? t('sent') : t('resent'));
        nudge();
        void queryClient.invalidateQueries({ queryKey: portalKeys.all(scope.websiteId) });
        form.reset();
        onOpenChange(false);
      } catch (error) {
        toast.error(errorMessage(error));
      }
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
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
              name='email'
              children={(field) => (
                <field.TextField label={t('email')} type='email' autoComplete='off' required />
              )}
            />
            <form.AppField
              name='name'
              children={(field) => <field.TextField label={t('name')} maxLength={120} />}
            />
            {offers.length > 0 && (
              <form.AppField
                name='offerId'
                children={(field) => (
                  <field.SelectField
                    label={t('offer')}
                    description={t('offerHint')}
                    options={[
                      { value: '', label: t('noOffer') },
                      ...offers.map((o) => ({ value: o.id, label: o.name ?? o.id }))
                    ]}
                  />
                )}
              />
            )}
            <form.AppField
              name='locale'
              children={(field) => (
                <field.RadioGroupField
                  label={t('language')}
                  options={[
                    { value: 'en', label: 'English' },
                    { value: 'fr', label: 'Français' }
                  ]}
                />
              )}
            />
          </FieldGroup>
          <DialogFooter>
            <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <form.AppForm>
              <form.SubmitButton>{t('submit')}</form.SubmitButton>
            </form.AppForm>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

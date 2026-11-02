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
import { useSiteScope } from '@/features/site/components/use-site-scope';
import { useErrorMessage } from '@/hooks/use-error-message';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import { isEmail } from '@/lib/validation/sanitize';
import { emailKeys } from '../api/queries';
import { saveSender } from '../api/service';
import type { EmailOverview } from '../api/types';

/**
 * Owners and admins: the name, reply-to address, postal address and colour of
 * the e-mails. The postal address is required by anti-spam law (CAN-SPAM) and
 * is printed in every e-mail's footer.
 */
export function SenderDialog({
  open,
  onOpenChange,
  overview
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  overview: EmailOverview;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        {open && <SenderForm overview={overview} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function SenderForm({ overview, onDone }: { overview: EmailOverview; onDone: () => void }) {
  const t = useTranslations('emailCampaigns.sender');
  const tv = useTranslations('validation');
  const scope = useSiteScope();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const schema = useMemo(
    () =>
      z.object({
        from_name: z
          .string()
          .trim()
          .max(60, { message: tv('maxLength', { max: 60 }) }),
        reply_to: z
          .string()
          .trim()
          .refine((v) => isEmail(v.toLowerCase()), { message: tv('email') }),
        postal_address: z
          .string()
          .trim()
          .min(10, { message: t('addressRequired') })
          .max(300, { message: tv('maxLength', { max: 300 }) }),
        brand_color: z.string().regex(/^(#[0-9a-fA-F]{6})?$/, { message: tv('invalid') })
      }),
    [t, tv]
  );
  const form = useAppForm({
    defaultValues: {
      from_name: overview.sender?.from_name ?? '',
      reply_to: overview.sender?.reply_to ?? overview.brand.reply_to ?? '',
      postal_address: overview.sender?.postal_address ?? '',
      brand_color: overview.sender?.brand_color ?? overview.brand.brand_color ?? '#111827'
    },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      try {
        await saveSender(createClient(), scope.websiteId, value);
        await queryClient.invalidateQueries({ queryKey: emailKeys.all(scope.websiteId) });
        toast.success(t('saved'));
        onDone();
      } catch (e) {
        toast.error(errorMessage(e, 'saveFailed'));
      }
    }
  });
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription>{t('description')}</DialogDescription>
      </DialogHeader>
      <form
        id='sender-form'
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <FieldGroup>
          <form.AppField
            name='from_name'
            children={(field) => (
              <field.TextField
                label={t('fromName')}
                description={t('fromNameHint', { name: overview.brand.business_name })}
                maxLength={60}
              />
            )}
          />
          <form.AppField
            name='reply_to'
            children={(field) => (
              <field.TextField
                label={t('replyTo')}
                description={t('replyToHint')}
                type='email'
                required
                maxLength={254}
              />
            )}
          />
          <form.AppField
            name='postal_address'
            children={(field) => (
              <field.TextareaField
                label={t('postalAddress')}
                description={t('postalAddressHint')}
                rows={3}
                required
                maxLength={300}
              />
            )}
          />
          <form.AppField
            name='brand_color'
            children={(field) => (
              <field.ColorField label={t('brandColor')} description={t('brandColorHint')} />
            )}
          />
        </FieldGroup>
      </form>
      <DialogFooter>
        <Button variant='outline' onClick={onDone}>
          {t('cancel')}
        </Button>
        <form.AppForm>
          <form.SubmitButton form='sender-form'>{t('save')}</form.SubmitButton>
        </form.AppForm>
      </DialogFooter>
    </>
  );
}

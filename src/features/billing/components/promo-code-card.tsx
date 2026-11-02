'use client';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';
import { Icons } from '@/components/icons';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useErrorMessage } from '@/hooks/use-error-message';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import { billingKeys } from '../api/queries';
import { redeemDiscountCode } from '../api/service';
import { PROMO_CODE_RE } from '../lib/format';
import { useDiscountText } from './discount-badge';

/** Owners and admins: redeem a promo code from LevelUp (once per organization). */
export function PromoCodeCard({ organizationId }: { organizationId: string }) {
  const t = useTranslations('billing.promo');
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const discountText = useDiscountText();
  const schema = useMemo(
    () =>
      z.object({
        code: z
          .string()
          .trim()
          .regex(PROMO_CODE_RE, { message: t('invalidFormat') })
      }),
    [t]
  );
  const form = useAppForm({
    defaultValues: { code: '' },
    validators: { onSubmit: schema },
    onSubmit: async ({ value, formApi }) => {
      try {
        const result = await redeemDiscountCode(createClient(), organizationId, value.code.trim());
        if (result.status === 'redeemed') {
          toast.success(t('applied', { discount: discountText(result.discount) }));
          formApi.reset();
          await queryClient.invalidateQueries({
            queryKey: billingKeys.org(organizationId)
          });
        } else {
          toast.error(result.status === 'already_redeemed' ? t('already') : t('invalid'));
        }
      } catch (e) {
        toast.error(errorMessage(e, 'saveFailed'));
      }
    }
  });

  return (
    <Card className='h-full'>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <Icons.discount className='size-5' aria-hidden />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className='flex flex-col gap-3 sm:flex-row sm:items-start'
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <div className='flex-1'>
            <form.AppField
              name='code'
              children={(field) => (
                <field.TextField
                  label={t('label')}
                  placeholder={t('placeholder')}
                  autoComplete='off'
                  autoCapitalize='characters'
                  spellCheck={false}
                  maxLength={32}
                  showCount={false}
                  className='font-mono uppercase placeholder:normal-case'
                />
              )}
            />
          </div>
          <form.AppForm>
            <form.SubmitButton className='sm:mt-6'>{t('apply')}</form.SubmitButton>
          </form.AppForm>
        </form>
      </CardContent>
    </Card>
  );
}

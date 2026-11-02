'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
import { LoadingButton } from '@/components/ui/loading-button';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { useErrorMessage } from '@/hooks/use-error-message';
import { toast } from 'sonner';
import * as z from 'zod';
import { useFields } from '@/lib/validation/use-fields';
import { createClientSite } from '../api/clients';
import { adminInsightKeys, featuresQueryOptions } from '../api/queries';

export function NewClientForm() {
  const t = useTranslations('admin.newClient');
  const tv = useTranslations('validation');
  const errorMessage = useErrorMessage();
  const f = useFields();
  const schema = useMemo(
    () =>
      z.object({
        organizationName: f.text(120).refine((v) => v.length >= 2, { message: tv('nameRequired') }),
        websiteName: f.text(120).refine((v) => v.length >= 2, { message: tv('nameRequired') }),
        primaryDomain: f
          .text(253)
          .refine((v) => v === '' || /^(https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}\/?$/i.test(v), {
            message: t('invalidDomain')
          }),
        siteType: f.text(48).refine((v) => v === '' || /^[a-z][a-z0-9_]{1,47}$/.test(v), {
          message: t('invalidSiteType')
        }),
        features: z.array(z.string().regex(/^[a-z0-9_]{1,64}$/)).max(50),
        ownerEmail: f.email()
      }),
    [t, tv, f]
  );
  const db = createClient();
  const queryClient = useQueryClient();
  const { data: features = [] } = useQuery(featuresQueryOptions(db));
  const [result, setResult] = useState<{ websiteId: string; owner: string | null } | null>(null);

  const form = useAppForm({
    defaultValues: {
      organizationName: '',
      websiteName: '',
      primaryDomain: '',
      siteType: '',
      features: ['contact_form'] as string[],
      ownerEmail: ''
    },
    validators: { onSubmit: schema },
    onSubmit: async ({ value, formApi }) => {
      try {
        const res = await createClientSite(db, schema.parse(value));
        setResult({ websiteId: res.website_id, owner: res.owner });
        toast.success(t('created'));
        formApi.reset();
        void queryClient.invalidateQueries({ queryKey: adminInsightKeys.allWebsites() });
      } catch (e) {
        toast.error(errorMessage(e));
      }
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {result && (
          <div className='bg-muted mb-4 space-y-1 rounded-md p-3 text-sm'>
            <p>{t.rich('siteCreated', { id: () => <code>{result.websiteId}</code> })}</p>
            <p className='text-muted-foreground'>
              {result.owner === 'invited'
                ? t('ownerInvited')
                : result.owner
                  ? t('ownerAdded')
                  : t('noOwner')}{' '}
              {t('tagHint')}
            </p>
          </div>
        )}
        <form
          className='space-y-4'
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
        >
          <FieldGroup className='grid grid-cols-1 gap-4 md:grid-cols-2'>
            <form.AppField
              name='organizationName'
              children={(field) => (
                <field.TextField
                  label={t('business')}
                  placeholder={t('businessPlaceholder')}
                  maxLength={120}
                />
              )}
            />
            <form.AppField
              name='websiteName'
              children={(field) => (
                <field.TextField
                  label={t('websiteName')}
                  placeholder={t('businessPlaceholder')}
                  maxLength={120}
                />
              )}
            />
            <form.AppField
              name='primaryDomain'
              children={(field) => (
                <field.TextField
                  label={t('domain')}
                  placeholder='salon-elegance.com'
                  maxLength={253}
                  showCount={false}
                />
              )}
            />
            <form.AppField
              name='siteType'
              children={(field) => (
                <field.TextField label={t('siteType')} placeholder='salon' maxLength={48} />
              )}
            />
            <form.AppField
              name='ownerEmail'
              children={(field) => (
                <field.TextField
                  label={t('ownerEmail')}
                  type='email'
                  placeholder='client@…'
                  maxLength={254}
                />
              )}
            />
          </FieldGroup>
          <form.Field
            name='features'
            children={(field) => (
              <div className='space-y-2'>
                <p className='text-sm font-medium'>{t('features')}</p>
                <div className='flex flex-wrap gap-2'>
                  {features.map((f) => {
                    const on = field.state.value.includes(f.key);
                    return (
                      <Button
                        key={f.key}
                        type='button'
                        size='sm'
                        variant={on ? 'default' : 'outline'}
                        title={f.description ?? undefined}
                        aria-pressed={on}
                        onClick={() =>
                          field.handleChange(
                            on
                              ? field.state.value.filter((k) => k !== f.key)
                              : [...field.state.value, f.key]
                          )
                        }
                      >
                        {f.name}
                      </Button>
                    );
                  })}
                </div>
              </div>
            )}
          />
          <form.Subscribe
            selector={(s) => s.isSubmitting}
            children={(submitting) => (
              <LoadingButton type='submit' loading={submitting}>
                {t('submit')}
              </LoadingButton>
            )}
          />
        </form>
      </CardContent>
    </Card>
  );
}

'use client';

import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
import { LoadingButton } from '@/components/ui/loading-button';
import { setActiveOrganization } from '@/lib/auth/actions';
import { useDashboardSession } from '@/lib/auth/session-context';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import { slugify } from '@/features/site/api/service';
import { useRouter } from 'next/navigation';
import { useMemo, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useErrorMessage } from '@/hooks/use-error-message';
import { toast } from 'sonner';
import * as z from 'zod';
import { createOrganization } from '../api/service';

export function WorkspacesView() {
  const { organizations, activeOrg } = useDashboardSession();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const t = useTranslations('workspaces');
  const tRole = useTranslations('common.roles');
  const tv = useTranslations('validation');
  const errorMessage = useErrorMessage();
  const createSchema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .trim()
          .min(2, { message: tv('nameRequired') })
          .max(120)
      }),
    [tv]
  );

  const open = (id: string, href = '/dashboard/site') =>
    startTransition(async () => {
      await setActiveOrganization(id);
      router.push(href);
      router.refresh();
    });

  const form = useAppForm({
    defaultValues: { name: '' },
    validators: { onSubmit: createSchema },
    onSubmit: async ({ value }) => {
      try {
        const slug = `${slugify(value.name).slice(0, 40)}-${Math.random().toString(36).slice(2, 6)}`;
        const org = await createOrganization(createClient(), value.name.trim(), slug);
        toast.success(t('created'));
        open(org.id, '/dashboard/workspaces/team');
      } catch (e) {
        toast.error(errorMessage(e));
      }
    }
  });

  return (
    <div className='grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]'>
      <div className='space-y-3'>
        {organizations.length === 0 && (
          <p className='text-muted-foreground text-sm'>{t('empty')}</p>
        )}
        {organizations.map((org) => (
          <Card key={org.id}>
            <CardContent className='flex items-center gap-3'>
              <div className='flex size-10 items-center justify-center overflow-hidden rounded-lg border border-violet-500/20 bg-violet-500/10'>
                {org.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={org.logoUrl} alt='' className='size-full bg-white object-contain' />
                ) : (
                  <Icons.logo className='size-6' />
                )}
              </div>
              <div className='min-w-0 flex-1'>
                <p className='truncate font-medium'>{org.name}</p>
                <p className='text-muted-foreground text-xs'>
                  {org.role ? tRole(org.role) : t('staffAccess')}
                </p>
              </div>
              {org.id === activeOrg?.id ? (
                <Badge>{t('active')}</Badge>
              ) : (
                <Button size='sm' variant='outline' disabled={pending} onClick={() => open(org.id)}>
                  {t('open')}
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className='h-fit'>
        <CardHeader>
          <CardTitle>{t('newTitle')}</CardTitle>
          <CardDescription>{t('newDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className='space-y-4'
            onSubmit={(e) => {
              e.preventDefault();
              form.handleSubmit();
            }}
          >
            <FieldGroup>
              <form.AppField
                name='name'
                children={(field) => (
                  <field.TextField label={t('name')} placeholder={t('namePlaceholder')} />
                )}
              />
            </FieldGroup>
            <form.Subscribe
              selector={(s) => s.isSubmitting}
              children={(submitting) => (
                <LoadingButton type='submit' loading={submitting || pending} className='w-full'>
                  {t('create')}
                </LoadingButton>
              )}
            />
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

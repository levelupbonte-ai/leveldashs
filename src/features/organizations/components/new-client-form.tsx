'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
import { LoadingButton } from '@/components/ui/loading-button';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';
import { featuresQueryOptions, orgKeys } from '../api/queries';
import { createClientSite } from '../api/service';

const schema = z.object({
  organizationName: z.string().trim().min(2, { message: 'Nom requis' }).max(120),
  websiteName: z.string().trim().min(2, { message: 'Nom requis' }).max(120),
  primaryDomain: z
    .string()
    .trim()
    .refine((v) => v === '' || /^(https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}\/?$/i.test(v), {
      message: 'Domaine invalide (ex. salon.com)'
    }),
  siteType: z
    .string()
    .trim()
    .refine((v) => v === '' || /^[a-z][a-z0-9_]{1,47}$/.test(v), {
      message: 'Minuscules et _ (ex. barbershop)'
    }),
  features: z.array(z.string()),
  ownerEmail: z
    .string()
    .trim()
    .refine((v) => v === '' || z.string().email().safeParse(v).success, {
      message: 'E-mail invalide'
    })
});

export function NewClientForm() {
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
        const res = await createClientSite(db, value);
        setResult({ websiteId: res.website_id, owner: res.owner });
        toast.success('Client créé');
        formApi.reset();
        void queryClient.invalidateQueries({ queryKey: orgKeys.allWebsites() });
      } catch (e) {
        toast.error((e as Error).message);
      }
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nouveau client</CardTitle>
        <CardDescription>
          Crée l’organisation, le site et ses fonctions, et invite le propriétaire : il devient
          propriétaire dès qu’il crée son compte avec cet e-mail (vérifié).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {result && (
          <div className='bg-muted mb-4 space-y-1 rounded-md p-3 text-sm'>
            <p>
              Site créé : <code>{result.websiteId}</code>
            </p>
            <p className='text-muted-foreground'>
              {result.owner === 'invited'
                ? 'Invitation enregistrée : le client doit créer son compte avec cet e-mail.'
                : result.owner
                  ? 'Le propriétaire a été ajouté.'
                  : 'Aucun propriétaire invité.'}{' '}
              Le code d’installation est dans « Développeurs » une fois le site sélectionné.
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
                <field.TextField label='Entreprise' placeholder='Salon Élégance' />
              )}
            />
            <form.AppField
              name='websiteName'
              children={(field) => (
                <field.TextField label='Nom du site' placeholder='Salon Élégance' />
              )}
            />
            <form.AppField
              name='primaryDomain'
              children={(field) => (
                <field.TextField label='Domaine' placeholder='salon-elegance.com' />
              )}
            />
            <form.AppField
              name='siteType'
              children={(field) => <field.TextField label='Type de site' placeholder='salon' />}
            />
            <form.AppField
              name='ownerEmail'
              children={(field) => (
                <field.TextField
                  label='E-mail du propriétaire'
                  type='email'
                  placeholder='client@…'
                />
              )}
            />
          </FieldGroup>
          <form.Field
            name='features'
            children={(field) => (
              <div className='space-y-2'>
                <p className='text-sm font-medium'>Fonctions</p>
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
                Créer le client
              </LoadingButton>
            )}
          />
        </form>
      </CardContent>
    </Card>
  );
}

'use client';

import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { createClient } from '@/lib/supabase/client';
import { accessRequestsQueryOptions, orgKeys } from '../api/queries';
import { decideAccessRequest, type AccessRequest } from '../api/service';

const STATUS: Record<
  AccessRequest['status'],
  { label: string; variant: 'default' | 'secondary' | 'outline' }
> = {
  pending: { label: 'En attente', variant: 'default' },
  approved: { label: 'Validée', variant: 'secondary' },
  rejected: { label: 'Refusée', variant: 'outline' }
};

/** LevelUp staff: who asked for dashboard access, approve (creates their organization) or reject. */
export function AccessRequests() {
  const queryClient = useQueryClient();
  const { data } = useSuspenseQuery(accessRequestsQueryOptions(createClient()));
  const decide = useMutation({
    mutationFn: decideAccessRequest,
    onSuccess: (_, vars) => {
      toast.success(
        vars.approve ? 'Accès validé, le client a été prévenu par e-mail.' : 'Demande refusée.'
      );
      void queryClient.invalidateQueries({ queryKey: orgKeys.accessRequests() });
      void queryClient.invalidateQueries({ queryKey: orgKeys.allWebsites() });
    },
    onError: (e) => toast.error(e.message)
  });
  const pending = data.filter((r) => r.status === 'pending').length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          Demandes d’accès {pending > 0 && <Badge>{pending}</Badge>}
        </CardTitle>
        <CardDescription>
          Valider une demande crée l’organisation du client (à son nom) et l’en rend propriétaire.
          Vous pourrez ensuite lui ajouter un site ci-dessous.
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-3'>
        {data.length === 0 && (
          <p className='text-muted-foreground text-sm'>Aucune demande pour le moment.</p>
        )}
        {data.map((r) => (
          <div
            key={r.user_id}
            className='flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-start sm:justify-between'
          >
            <div className='min-w-0 space-y-1 text-sm'>
              <p className='font-medium'>
                {r.business_name}{' '}
                <Badge variant={STATUS[r.status].variant} className='ml-1 align-middle'>
                  {STATUS[r.status].label}
                </Badge>
              </p>
              <p className='text-muted-foreground'>
                {r.full_name ? `${r.full_name} · ` : ''}
                {r.email}
                {r.phone ? ` · ${r.phone}` : ''}
              </p>
              {r.website && <p className='text-muted-foreground truncate'>{r.website}</p>}
              {r.message && (
                <p className='text-muted-foreground whitespace-pre-wrap'>{r.message}</p>
              )}
              <p className='text-muted-foreground text-xs'>
                {new Date(r.created_at).toLocaleString('fr-FR')}
              </p>
            </div>
            {r.status === 'pending' && (
              <div className='flex shrink-0 gap-2'>
                <Button
                  size='sm'
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ userId: r.user_id, approve: true })}
                >
                  Valider
                </Button>
                <Button
                  size='sm'
                  variant='outline'
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ userId: r.user_id, approve: false })}
                >
                  Refuser
                </Button>
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

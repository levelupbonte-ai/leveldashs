'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { createClient } from '@/lib/supabase/client';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useSiteMutations } from '../api/mutations';
import { waitlistQueryOptions } from '../api/queries';
import type { WaitlistStatus } from '../api/types';
import { StatusSelect } from './status-select';
import { useSiteScope } from './use-site-scope';

const STATUS: Record<WaitlistStatus, string> = {
  waiting: 'En attente',
  called: 'Appelé',
  in_chair: 'En cours',
  served: 'Servi',
  cancelled: 'Annulé'
};

export function WaitlistBoard() {
  const scope = useSiteScope();
  const { data } = useSuspenseQuery(waitlistQueryOptions(createClient(), scope.websiteId));
  const { updateWaitlist } = useSiteMutations(scope);
  const active = data
    .filter((e) => ['waiting', 'called', 'in_chair'].includes(e.status))
    .toSorted((a, b) => a.position - b.position);
  const done = data
    .filter((e) => !['waiting', 'called', 'in_chair'].includes(e.status))
    .slice(0, 30);

  const list = (entries: typeof data) =>
    entries.map((e) => (
      <div key={e.id} className='flex items-center gap-3 border-b py-3 last:border-0'>
        <Badge variant='outline' className='font-mono'>
          #{e.position}
        </Badge>
        <div className='min-w-0 flex-1'>
          <p className='truncate font-medium'>{e.customer_name}</p>
          <p className='text-muted-foreground truncate text-xs'>
            {[e.service_name, e.team_member_name, e.customer_phone].filter(Boolean).join(' · ')}
          </p>
        </div>
        <StatusSelect
          label='Statut'
          value={e.status}
          options={STATUS}
          disabled={!scope.canEdit}
          onChange={(status) => updateWaitlist.mutate({ id: e.id, status })}
        />
      </div>
    ));

  return (
    <div className='grid gap-4 lg:grid-cols-2'>
      <Card>
        <CardHeader>
          <CardTitle>File actuelle ({active.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {active.length ? (
            list(active)
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>Personne en attente</EmptyTitle>
                <EmptyDescription>
                  Ouvrez ou fermez la liste d’attente dans Paramètres du site (clé « waitlist »).
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Récemment</CardTitle>
        </CardHeader>
        <CardContent>
          {done.length ? list(done) : <p className='text-muted-foreground text-sm'>—</p>}
        </CardContent>
      </Card>
    </div>
  );
}

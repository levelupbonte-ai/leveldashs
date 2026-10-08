'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { setActiveWebsite } from '@/lib/auth/actions';
import { createClient } from '@/lib/supabase/client';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { allWebsitesQueryOptions } from '../api/queries';

/** LevelUp staff: every client website, one click to manage it. */
export function AdminWebsites() {
  const { data } = useSuspenseQuery(allWebsitesQueryOptions(createClient()));
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s
      ? data.filter((w) =>
          [w.name, w.primaryDomain, w.organizationName, w.id].some((v) =>
            v?.toLowerCase().includes(s)
          )
        )
      : data;
  }, [data, q]);

  return (
    <div className='space-y-4'>
      <Input
        placeholder='Rechercher un client, un domaine…'
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className='max-w-sm'
      />
      <div className='rounded-md border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Site</TableHead>
              <TableHead>Organisation</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead>Fonctions</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((w) => (
              <TableRow key={w.id}>
                <TableCell>
                  <div className='font-medium'>{w.primaryDomain ?? w.name}</div>
                  <div className='text-muted-foreground font-mono text-xs'>{w.id}</div>
                </TableCell>
                <TableCell>{w.organizationName}</TableCell>
                <TableCell>
                  <Badge variant={w.status === 'active' ? 'default' : 'secondary'}>
                    {w.status}
                  </Badge>
                </TableCell>
                <TableCell className='max-w-xs'>
                  <div className='flex flex-wrap gap-1'>
                    {w.features.map((f) => (
                      <Badge key={f} variant='outline'>
                        {f}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <Button
                    size='sm'
                    variant='outline'
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        await setActiveWebsite(w.id);
                        router.push('/dashboard/site');
                        router.refresh();
                      })
                    }
                  >
                    Gérer
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

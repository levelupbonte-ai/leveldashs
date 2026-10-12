import type { SupabaseClient } from '@supabase/supabase-js';
import { queryOptions } from '@tanstack/react-query';
import { getContract, listContracts } from './service';

export const contractKeys = {
  all: ['contracts'] as const,
  list: (organizationId: string) => [...contractKeys.all, 'list', organizationId] as const,
  detail: (id: string) => [...contractKeys.all, 'detail', id] as const
};

export const contractsQueryOptions = (db: SupabaseClient, organizationId: string) =>
  queryOptions({
    queryKey: contractKeys.list(organizationId),
    queryFn: () => listContracts(db, organizationId)
  });

export const contractQueryOptions = (db: SupabaseClient, id: string) =>
  queryOptions({
    queryKey: contractKeys.detail(id),
    queryFn: () => getContract(db, id)
  });

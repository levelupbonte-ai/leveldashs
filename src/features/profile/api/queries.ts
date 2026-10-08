import type { SupabaseClient } from '@supabase/supabase-js';
import { queryOptions } from '@tanstack/react-query';
import { getMfaState } from './service';

export const securityKeys = {
  all: ['account-security'] as const,
  mfa: () => [...securityKeys.all, 'mfa'] as const
};

export const mfaStateQueryOptions = (db: SupabaseClient) =>
  queryOptions({
    queryKey: securityKeys.mfa(),
    queryFn: () => getMfaState(db)
  });

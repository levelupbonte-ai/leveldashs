import type { SupabaseClient } from '@supabase/supabase-js';
import { queryOptions } from '@tanstack/react-query';
import { getMfaState, listPasskeys } from './service';

export const securityKeys = {
  all: ['account-security'] as const,
  mfa: () => [...securityKeys.all, 'mfa'] as const,
  passkeys: () => [...securityKeys.all, 'passkeys'] as const
};

export const mfaStateQueryOptions = (db: SupabaseClient) =>
  queryOptions({
    queryKey: securityKeys.mfa(),
    queryFn: () => getMfaState(db)
  });

export const passkeysQueryOptions = (db: SupabaseClient) =>
  queryOptions({
    queryKey: securityKeys.passkeys(),
    queryFn: () => listPasskeys(db)
  });

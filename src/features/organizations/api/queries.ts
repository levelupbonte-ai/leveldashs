import type { SupabaseClient } from '@supabase/supabase-js';
import { queryOptions } from '@tanstack/react-query';
import { listAllWebsites, listFeatures, listInvitations, listMembers } from './service';

export const orgKeys = {
  all: ['organizations'] as const,
  members: (organizationId: string) => [...orgKeys.all, 'members', organizationId] as const,
  allWebsites: () => [...orgKeys.all, 'all-websites'] as const,
  features: () => ['features'] as const,
  invitations: (organizationId: string) => [...orgKeys.all, 'invitations', organizationId] as const
};

export const membersQueryOptions = (db: SupabaseClient, organizationId: string) =>
  queryOptions({
    queryKey: orgKeys.members(organizationId),
    queryFn: () => listMembers(db, organizationId)
  });

export const allWebsitesQueryOptions = (db: SupabaseClient) =>
  queryOptions({
    queryKey: orgKeys.allWebsites(),
    queryFn: () => listAllWebsites(db)
  });

export const featuresQueryOptions = (db: SupabaseClient) =>
  queryOptions({
    queryKey: orgKeys.features(),
    queryFn: () => listFeatures(db),
    staleTime: 10 * 60 * 1000
  });

export const invitationsQueryOptions = (db: SupabaseClient, organizationId: string) =>
  queryOptions({
    queryKey: orgKeys.invitations(organizationId),
    queryFn: () => listInvitations(db, organizationId)
  });

import type { SupabaseClient } from '@supabase/supabase-js';
import { queryOptions } from '@tanstack/react-query';
import { listInvitations, listMembers } from './service';

export const orgKeys = {
  all: ['organizations'] as const,
  members: (organizationId: string) => [...orgKeys.all, 'members', organizationId] as const,
  invitations: (organizationId: string) => [...orgKeys.all, 'invitations', organizationId] as const
};

export const membersQueryOptions = (db: SupabaseClient, organizationId: string) =>
  queryOptions({
    queryKey: orgKeys.members(organizationId),
    queryFn: () => listMembers(db, organizationId)
  });

export const invitationsQueryOptions = (db: SupabaseClient, organizationId: string) =>
  queryOptions({
    queryKey: orgKeys.invitations(organizationId),
    queryFn: () => listInvitations(db, organizationId)
  });

import type { SupabaseClient } from '@supabase/supabase-js';
import { queryOptions } from '@tanstack/react-query';
import { listAccessRequests, listAllWebsites, listFeatures } from './clients';
import { listContractTemplates, listOrgContracts, listRequiredTasks } from './contracts';
import { getAiInsights, listProjectRequests } from './service';

export const adminInsightKeys = {
  all: ['platform-admin'] as const,
  ai: () => [...adminInsightKeys.all, 'ai'] as const,
  projectRequests: () => [...adminInsightKeys.all, 'project-requests'] as const,
  allWebsites: () => [...adminInsightKeys.all, 'all-websites'] as const,
  features: () => [...adminInsightKeys.all, 'features'] as const,
  accessRequests: () => [...adminInsightKeys.all, 'access-requests'] as const,
  contracts: () => [...adminInsightKeys.all, 'contracts'] as const,
  orgContracts: (organizationId: string) =>
    [...adminInsightKeys.contracts(), 'org', organizationId] as const,
  requiredTasks: (organizationId: string) =>
    [...adminInsightKeys.contracts(), 'tasks', organizationId] as const,
  templates: () => [...adminInsightKeys.contracts(), 'templates'] as const
};

export const contractTemplatesQueryOptions = (db: SupabaseClient) =>
  queryOptions({
    queryKey: adminInsightKeys.templates(),
    queryFn: () => listContractTemplates(db)
  });

export const orgContractsQueryOptions = (db: SupabaseClient, organizationId: string) =>
  queryOptions({
    queryKey: adminInsightKeys.orgContracts(organizationId),
    queryFn: () => listOrgContracts(db, organizationId)
  });

export const requiredTasksQueryOptions = (db: SupabaseClient, organizationId: string) =>
  queryOptions({
    queryKey: adminInsightKeys.requiredTasks(organizationId),
    queryFn: () => listRequiredTasks(db, organizationId)
  });

export const allWebsitesQueryOptions = (db: SupabaseClient) =>
  queryOptions({
    queryKey: adminInsightKeys.allWebsites(),
    queryFn: () => listAllWebsites(db)
  });

export const featuresQueryOptions = (db: SupabaseClient) =>
  queryOptions({
    queryKey: adminInsightKeys.features(),
    queryFn: () => listFeatures(db),
    staleTime: 10 * 60 * 1000
  });

export const accessRequestsQueryOptions = (db: SupabaseClient) =>
  queryOptions({
    queryKey: adminInsightKeys.accessRequests(),
    queryFn: () => listAccessRequests(db)
  });

export const aiInsightsQueryOptions = (db: SupabaseClient) =>
  queryOptions({
    queryKey: adminInsightKeys.ai(),
    queryFn: () => getAiInsights(db),
    staleTime: 60 * 1000
  });

export const projectRequestsQueryOptions = (db: SupabaseClient) =>
  queryOptions({
    queryKey: adminInsightKeys.projectRequests(),
    queryFn: () => listProjectRequests(db)
  });

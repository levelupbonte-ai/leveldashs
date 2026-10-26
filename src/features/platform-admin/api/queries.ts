import type { SupabaseClient } from '@supabase/supabase-js';
import { queryOptions } from '@tanstack/react-query';
import {
  getReviewContext,
  getSiteAccess,
  listAccessRequests,
  listAllWebsites,
  listFeatures
} from './clients';
import {
  getOrgBilling,
  listBillingOrgs,
  listDiscounts,
  listPlans,
  listUpgradeRequests
} from './billing';
import { listContractTemplates, listOrgContracts, listRequiredTasks } from './contracts';
import { getAiInsights, listProjectRequests } from './service';

export const adminInsightKeys = {
  all: ['platform-admin'] as const,
  ai: () => [...adminInsightKeys.all, 'ai'] as const,
  projectRequests: () => [...adminInsightKeys.all, 'project-requests'] as const,
  allWebsites: () => [...adminInsightKeys.all, 'all-websites'] as const,
  features: () => [...adminInsightKeys.all, 'features'] as const,
  accessRequests: () => [...adminInsightKeys.all, 'access-requests'] as const,
  reviewContext: (userId: string) =>
    [...adminInsightKeys.accessRequests(), 'review', userId] as const,
  siteAccess: (websiteId: string) => [...adminInsightKeys.all, 'site-access', websiteId] as const,
  contracts: () => [...adminInsightKeys.all, 'contracts'] as const,
  orgContracts: (organizationId: string) =>
    [...adminInsightKeys.contracts(), 'org', organizationId] as const,
  requiredTasks: (organizationId: string) =>
    [...adminInsightKeys.contracts(), 'tasks', organizationId] as const,
  templates: () => [...adminInsightKeys.contracts(), 'templates'] as const,
  billing: () => [...adminInsightKeys.all, 'billing'] as const,
  billingOrgs: () => [...adminInsightKeys.billing(), 'orgs'] as const,
  orgBilling: (organizationId: string) =>
    [...adminInsightKeys.billing(), 'org', organizationId] as const,
  plans: () => [...adminInsightKeys.billing(), 'plans'] as const,
  discounts: () => [...adminInsightKeys.billing(), 'discounts'] as const,
  upgradeRequests: () => [...adminInsightKeys.billing(), 'upgrade-requests'] as const
};

export const billingOrgsQueryOptions = (db: SupabaseClient) =>
  queryOptions({ queryKey: adminInsightKeys.billingOrgs(), queryFn: () => listBillingOrgs(db) });

export const orgBillingQueryOptions = (db: SupabaseClient, organizationId: string) =>
  queryOptions({
    queryKey: adminInsightKeys.orgBilling(organizationId),
    queryFn: () => getOrgBilling(db, organizationId),
    staleTime: 0
  });

export const plansQueryOptions = (db: SupabaseClient) =>
  queryOptions({ queryKey: adminInsightKeys.plans(), queryFn: () => listPlans(db) });

export const discountsQueryOptions = (db: SupabaseClient) =>
  queryOptions({ queryKey: adminInsightKeys.discounts(), queryFn: () => listDiscounts(db) });

export const upgradeRequestsQueryOptions = (db: SupabaseClient) =>
  queryOptions({
    queryKey: adminInsightKeys.upgradeRequests(),
    queryFn: () => listUpgradeRequests(db)
  });

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

export const reviewContextQueryOptions = (db: SupabaseClient, userId: string) =>
  queryOptions({
    queryKey: adminInsightKeys.reviewContext(userId),
    queryFn: () => getReviewContext(db, userId),
    staleTime: 0
  });

export const siteAccessQueryOptions = (db: SupabaseClient, websiteId: string) =>
  queryOptions({
    queryKey: adminInsightKeys.siteAccess(websiteId),
    queryFn: () => getSiteAccess(db, websiteId)
  });

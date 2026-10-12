export type OrgRole = 'owner' | 'admin' | 'editor' | 'viewer';

export const ROLE_RANK: Record<OrgRole, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
  owner: 4
};

export interface DashboardUser {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
}

export interface DashboardOrg {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  /** null when a LevelUp platform admin views an organization they are not a member of */
  role: OrgRole | null;
}

export interface DashboardWebsite {
  id: string;
  name: string;
  primaryDomain: string | null;
  status: string;
  features: string[];
}

/** Dashboard gate state of the active organization (public.dashboard_access). */
export type OrgAccessState = 'active' | 'contract_required' | 'tasks_required' | 'suspended';

/** Setup steps LevelUp can make blocking (public.organization_required_tasks). */
export type RequiredTask = 'profile' | 'logo' | 'mfa';

export interface DashboardAccess {
  state: OrgAccessState;
  /** Blocking setup steps the user still has to finish in the active organization. */
  pendingTasks: RequiredTask[];
  /** LevelUp sent the active organization at least one contract. */
  hasContracts: boolean;
}

/** Pages a locked organization can still open (contract, tasks, account). */
export const LOCKED_ALLOWED_PATHS = ['/dashboard/contract', '/dashboard/profile'] as const;
export const CONTRACT_PATH = '/dashboard/contract';

export function isLockedState(state: OrgAccessState): boolean {
  return state !== 'active';
}

export function isAllowedWhileLocked(pathname: string): boolean {
  return LOCKED_ALLOWED_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export interface DashboardSession {
  user: DashboardUser;
  isPlatformAdmin: boolean;
  /** Two-factor (TOTP) status; `required` for platform admins and org owners/admins. */
  mfa: { enabled: boolean; required: boolean };
  organizations: DashboardOrg[];
  activeOrg: DashboardOrg | null;
  websites: DashboardWebsite[];
  activeWebsite: DashboardWebsite | null;
  /** Contract / required tasks gate of the active organization (never locks staff). */
  access: DashboardAccess;
}

export function hasRole(role: OrgRole | null | undefined, min: OrgRole): boolean {
  return !!role && ROLE_RANK[role] >= ROLE_RANK[min];
}

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

export interface DashboardSession {
  user: DashboardUser;
  isPlatformAdmin: boolean;
  /** Two-factor (TOTP) status; `required` for platform admins and org owners/admins. */
  mfa: { enabled: boolean; required: boolean };
  organizations: DashboardOrg[];
  activeOrg: DashboardOrg | null;
  websites: DashboardWebsite[];
  activeWebsite: DashboardWebsite | null;
}

export function hasRole(role: OrgRole | null | undefined, min: OrgRole): boolean {
  return !!role && ROLE_RANK[role] >= ROLE_RANK[min];
}

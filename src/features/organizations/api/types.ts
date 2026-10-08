import type { OrgRole } from '@/lib/auth/types';

export interface OrgMember {
  userId: string;
  role: OrgRole;
  fullName: string | null;
  email: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

export interface AdminWebsiteRow {
  id: string;
  name: string;
  primaryDomain: string | null;
  status: string;
  organizationId: string;
  organizationName: string;
  features: string[];
}

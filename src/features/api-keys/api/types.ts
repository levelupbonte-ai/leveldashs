export const KEY_SCOPES = ['payments:write', 'events:write', 'portal:access'] as const;
export type KeyScope = (typeof KEY_SCOPES)[number];
export type KeyMode = 'live' | 'test';

/** A server key as listed (the secret and its hash never leave the database). */
export interface SiteApiKey {
  id: string;
  name: string;
  prefix: 'lu_live_' | 'lu_test_';
  key_hint: string;
  scopes: KeyScope[];
  created_by: string | null;
  /** Display name of the creator (null when unknown or no longer a member). */
  created_by_name: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

/** Returned once by site_create_api_key: the full key is never shown again. */
export interface CreatedApiKey {
  id: string;
  key: string;
  prefix: string;
  key_hint: string;
}

export interface CreateKeyInput {
  name: string;
  mode: KeyMode;
  scopes: KeyScope[];
}

/** Actions written to site_audit_log by the database. */
export const AUDIT_ACTIONS = [
  'api_key.created',
  'api_key.revoked',
  'payments.exported',
  'project_request.updated'
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** One line of the Developers → Activity feed (owners and admins). */
export type DeveloperActivity =
  | {
      kind: 'audit';
      id: string;
      at: string;
      action: AuditAction | string;
      actor: string | null;
      /** Key name and masked key (`lu_live_…7c2e`) when the action is about a key. */
      keyName: string | null;
      keyHint: string | null;
    }
  | {
      kind: 'payment_event';
      id: string;
      at: string;
      status: string;
      applied: boolean;
      eventId: string;
    };

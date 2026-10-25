export const KEY_SCOPES = ['payments:write', 'events:write'] as const;
export type KeyScope = (typeof KEY_SCOPES)[number];
export type KeyMode = 'live' | 'test';

/** A server key as listed (the secret and its hash never leave the database). */
export interface SiteApiKey {
  id: string;
  name: string;
  prefix: 'lu_live_' | 'lu_test_';
  key_hint: string;
  scopes: KeyScope[];
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

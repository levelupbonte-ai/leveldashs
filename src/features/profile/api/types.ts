import type { AuthenticatorAssuranceLevels } from '@supabase/supabase-js';

export interface MfaFactor {
  id: string;
  friendlyName: string | null;
  factorType: string;
  status: 'verified' | 'unverified';
  createdAt: string;
}

export interface MfaState {
  /** Verified authenticator apps (TOTP). */
  factors: MfaFactor[];
  currentLevel: AuthenticatorAssuranceLevels | null;
  nextLevel: AuthenticatorAssuranceLevels | null;
}

export interface TotpEnrollment {
  factorId: string;
  /** SVG QR code as a data URL, from Supabase `mfa.enroll`. */
  qrCode: string;
  /** Base32 secret for manual entry. */
  secret: string;
}

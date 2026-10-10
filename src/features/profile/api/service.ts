import type { SupabaseClient } from '@supabase/supabase-js';
import { passkeyErrorKind } from '@/lib/auth/passkey';
import { AppError } from '@/lib/errors';
import type { MfaState, Passkey, TotpEnrollment } from './types';

export async function getMfaState(db: SupabaseClient): Promise<MfaState> {
  const [factorsRes, aalRes] = await Promise.all([
    db.auth.mfa.listFactors(),
    db.auth.mfa.getAuthenticatorAssuranceLevel()
  ]);
  if (factorsRes.error) throw new AppError('loadFailed', { cause: factorsRes.error });
  return {
    factors: factorsRes.data.all
      .filter((f) => f.factor_type === 'totp' && f.status === 'verified')
      .map((f) => ({
        id: f.id,
        friendlyName: f.friendly_name ?? null,
        factorType: f.factor_type,
        status: f.status,
        createdAt: f.created_at
      })),
    currentLevel: aalRes.data?.currentLevel ?? null,
    nextLevel: aalRes.data?.nextLevel ?? null
  };
}

/**
 * Starts a TOTP enrollment (QR code + secret). Leftover unverified factors are
 * removed first. `friendlyName` is the translated label shown in the factor list.
 */
export async function enrollTotp(
  db: SupabaseClient,
  friendlyName: string
): Promise<TotpEnrollment> {
  const { data: factors } = await db.auth.mfa.listFactors();
  const stale = (factors?.all ?? []).filter(
    (f) => f.factor_type === 'totp' && f.status === 'unverified'
  );
  await Promise.all(stale.map((f) => db.auth.mfa.unenroll({ factorId: f.id })));

  const { data, error } = await db.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName,
    issuer: 'LevelUp'
  });
  if (error || !data) throw new AppError('mfaEnrollFailed', { cause: error });
  return {
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret
  };
}

/** Confirms the enrollment with a first 6-digit code (the session becomes aal2). */
export async function verifyTotp(db: SupabaseClient, factorId: string, code: string) {
  const { error } = await db.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) {
    throw new AppError(
      error.code === 'mfa_verification_failed' ? 'mfaWrongCode' : 'mfaVerifyFailed',
      { cause: error }
    );
  }
}

/** Abandons an enrollment that was never verified. */
export async function cancelTotpEnrollment(db: SupabaseClient, factorId: string) {
  await db.auth.mfa.unenroll({ factorId });
}

/** Removing a verified factor needs an aal2 session (Supabase enforces it too). */
export async function removeFactor(db: SupabaseClient, factorId: string) {
  const { data: aal } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== 'aal2') {
    throw new AppError('mfaRequired');
  }
  const { error } = await db.auth.mfa.unenroll({ factorId });
  if (error) throw new AppError('deleteFailed', { cause: error });
  // Refresh the token so the session reflects the new assurance level.
  await db.auth.refreshSession();
}

/** Revokes every session of the account (all devices, all LevelUp apps). */
export async function signOutEverywhere(db: SupabaseClient) {
  const { error } = await db.auth.signOut({ scope: 'global' });
  if (error) throw new AppError('generic', { cause: error });
}

/** Passkeys (WebAuthn) of the signed-in user, most recent first. */
export async function listPasskeys(db: SupabaseClient): Promise<Passkey[]> {
  const { data, error } = await db.auth.passkey.list();
  if (error) throw new AppError('loadFailed', { cause: error });
  return (data ?? [])
    .map((p) => ({
      id: p.id,
      friendlyName: p.friendly_name ?? null,
      createdAt: p.created_at,
      lastUsedAt: p.last_used_at ?? null
    }))
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Error thrown when the person closes the browser prompt: the UI stays silent. */
export class PasskeyCancelledError extends Error {
  constructor() {
    super('cancelled');
    this.name = 'PasskeyCancelledError';
  }
}

/** Runs the WebAuthn registration ceremony (browser prompt) for the signed-in user. */
export async function addPasskey(db: SupabaseClient): Promise<void> {
  const { error } = await db.auth.registerPasskey();
  if (!error) return;
  const kind = passkeyErrorKind(error);
  if (kind === 'cancelled') throw new PasskeyCancelledError();
  if (kind === 'already_registered') throw new AppError('passkeyExists');
  if (kind === 'disabled') throw new AppError('passkeyDisabled');
  if ((error as { code?: string }).code === 'insufficient_aal') throw new AppError('mfaRequired');
  throw new AppError('createFailed', { cause: error });
}

export async function renamePasskey(db: SupabaseClient, passkeyId: string, friendlyName: string) {
  const { error } = await db.auth.passkey.update({ passkeyId, friendlyName });
  if (error) throw new AppError('saveFailed', { cause: error });
}

export async function deletePasskey(db: SupabaseClient, passkeyId: string) {
  const { error } = await db.auth.passkey.delete({ passkeyId });
  if (error) {
    throw new AppError(error.code === 'insufficient_aal' ? 'mfaRequired' : 'deleteFailed', {
      cause: error
    });
  }
}

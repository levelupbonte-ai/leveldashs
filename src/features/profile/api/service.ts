import type { SupabaseClient } from '@supabase/supabase-js';
import type { MfaState, TotpEnrollment } from './types';

export async function getMfaState(db: SupabaseClient): Promise<MfaState> {
  const [factorsRes, aalRes] = await Promise.all([
    db.auth.mfa.listFactors(),
    db.auth.mfa.getAuthenticatorAssuranceLevel()
  ]);
  if (factorsRes.error) throw new Error('Impossible de charger la sécurité du compte.');
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

/** Starts a TOTP enrollment (QR code + secret). Leftover unverified factors are removed first. */
export async function enrollTotp(db: SupabaseClient): Promise<TotpEnrollment> {
  const { data: factors } = await db.auth.mfa.listFactors();
  const stale = (factors?.all ?? []).filter(
    (f) => f.factor_type === 'totp' && f.status === 'unverified'
  );
  await Promise.all(stale.map((f) => db.auth.mfa.unenroll({ factorId: f.id })));

  const stamp = new Date().toLocaleString('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short'
  });
  const { data, error } = await db.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `Application d’authentification (${stamp})`,
    issuer: 'LevelUp'
  });
  if (error || !data) throw new Error('Activation impossible pour le moment.');
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
    throw new Error(
      error.code === 'mfa_verification_failed'
        ? 'Code incorrect. Saisissez le code actuel de l’application.'
        : 'Vérification impossible. Réessayez.'
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
    throw new Error('Confirmez d’abord votre code à 6 chiffres (reconnectez-vous).');
  }
  const { error } = await db.auth.mfa.unenroll({ factorId });
  if (error) throw new Error('Suppression impossible. Reconnectez-vous puis réessayez.');
  // Refresh the token so the session reflects the new assurance level.
  await db.auth.refreshSession();
}

/** Revokes every session of the account (all devices, all LevelUp apps). */
export async function signOutEverywhere(db: SupabaseClient) {
  const { error } = await db.auth.signOut({ scope: 'global' });
  if (error) throw new Error('Déconnexion impossible. Réessayez.');
}

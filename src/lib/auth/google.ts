/**
 * Google OAuth client used by Google Identity Services (the official "Sign in
 * with Google" button and One Tap). It is public by design (it appears in every
 * Google sign-in popup); the value below is the LevelUp web client, overridable
 * with NEXT_PUBLIC_GOOGLE_CLIENT_ID. Setup: docs/auth.md → Google button.
 */
export const GOOGLE_CLIENT_ID =
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
  '338931284223-7smftc9ekset4seun2er2tc3k5cb83p3.apps.googleusercontent.com';

export const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';

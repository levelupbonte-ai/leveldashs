'use client';
import { GIS_SCRIPT_URL } from '@/lib/auth/google';

// Minimal typings for the parts of Google Identity Services we use.
export interface GoogleCredentialResponse {
  credential?: string;
  select_by?: string;
}

interface GoogleIdConfiguration {
  client_id: string;
  callback: (response: GoogleCredentialResponse) => void;
  nonce?: string;
  context?: 'signin' | 'signup' | 'use';
  ux_mode?: 'popup' | 'redirect';
  use_fedcm_for_prompt?: boolean;
  itp_support?: boolean;
  auto_select?: boolean;
  cancel_on_tap_outside?: boolean;
}

export interface GoogleButtonConfiguration {
  type?: 'standard' | 'icon';
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'large' | 'medium' | 'small';
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  shape?: 'rectangular' | 'pill' | 'circle' | 'square';
  logo_alignment?: 'left' | 'center';
  width?: number;
  locale?: string;
}

export interface GoogleAccountsId {
  initialize(config: GoogleIdConfiguration): void;
  renderButton(parent: HTMLElement, options: GoogleButtonConfiguration): void;
  prompt(): void;
  cancel(): void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleAccountsId } };
  }
}

const LOAD_TIMEOUT_MS = 8000;
let loading: Promise<GoogleAccountsId> | null = null;

/**
 * Loads https://accounts.google.com/gsi/client once. Rejects when the script is
 * blocked (network, extension, CSP) or too slow, so the caller can fall back to
 * the redirect flow.
 */
export function loadGoogleIdentity(): Promise<GoogleAccountsId> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  if (loading) return loading;
  loading = new Promise<GoogleAccountsId>((resolve, reject) => {
    const done = () => {
      const id = window.google?.accounts?.id;
      if (id) resolve(id);
      else reject(new Error('gis_unavailable'));
    };
    const timer = window.setTimeout(() => reject(new Error('gis_timeout')), LOAD_TIMEOUT_MS);
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SCRIPT_URL}"]`);
    const script = existing ?? document.createElement('script');
    script.addEventListener('load', () => {
      window.clearTimeout(timer);
      done();
    });
    script.addEventListener('error', () => {
      window.clearTimeout(timer);
      reject(new Error('gis_blocked'));
    });
    if (!existing) {
      script.src = GIS_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  }).catch((error) => {
    loading = null;
    throw error;
  });
  return loading;
}

/**
 * Nonce pair for signInWithIdToken: Google gets the SHA-256 (hex) of the raw
 * value and puts it in the ID token; Supabase gets the raw value and checks it.
 */
export async function createNonce(): Promise<{ raw: string; hashed: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const raw = btoa(String.fromCharCode(...bytes));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  const hashed = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join(
    ''
  );
  return { raw, hashed };
}

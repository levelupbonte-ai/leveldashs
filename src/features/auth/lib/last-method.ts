'use client';
import { useSyncExternalStore } from 'react';

/**
 * Last sign-in method used in this browser, so the sign-in page can put it
 * first. Non-sensitive (no e-mail, no token): just the method name, kept in
 * localStorage under `lu_last_method`. Google is only confirmed after the OAuth
 * round trip, so it is marked "pending" in sessionStorage before the redirect
 * and promoted by `RecordLastMethod` once a signed-in page loads.
 */
export type SignInMethod = 'google' | 'passkey' | 'password';

const KEY = 'lu_last_method';
const PENDING_KEY = 'lu_pending_method';
const METHODS: SignInMethod[] = ['google', 'passkey', 'password'];
const listeners = new Set<() => void>();

function parse(value: string | null): SignInMethod | null {
  return METHODS.includes(value as SignInMethod) ? (value as SignInMethod) : null;
}

export function readLastMethod(): SignInMethod | null {
  try {
    return parse(window.localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export function saveLastMethod(method: SignInMethod) {
  try {
    window.localStorage.setItem(KEY, method);
  } catch {
    // Storage blocked (private mode): the sign-in page simply shows every method.
  }
  listeners.forEach((listener) => listener());
}

/** Before the Google redirect: confirmed by `promotePendingMethod` after sign-in. */
export function markPendingMethod(method: SignInMethod) {
  try {
    window.sessionStorage.setItem(PENDING_KEY, method);
  } catch {
    // Ignore: only a convenience.
  }
}

/** Called on signed-in pages: the pending method (if any) becomes the last one. */
export function promotePendingMethod() {
  try {
    const pending = parse(window.sessionStorage.getItem(PENDING_KEY));
    window.sessionStorage.removeItem(PENDING_KEY);
    if (pending) saveLastMethod(pending);
  } catch {
    // Ignore.
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** `null` on the server and on the first client render, then the stored value. */
export function useLastMethod(): SignInMethod | null {
  return useSyncExternalStore(subscribe, readLastMethod, () => null);
}

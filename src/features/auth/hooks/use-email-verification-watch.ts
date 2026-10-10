'use client';

import type { AuthError } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Captcha } from '../components/turnstile';

/**
 * Sign-up on one device, confirmation link opened on another (often the phone
 * that received the e-mail): the session is created where the link is opened,
 * not here. This hook brings the original tab along without any action:
 *
 * - every 10 s it retries `signInWithPassword` with the credentials typed a
 *   moment ago (kept in React state only, never stored). Supabase answers
 *   `email_not_confirmed` until the link is clicked, then signs in here.
 *   10 s keeps us at 30 calls / 5 min, the default sign-in rate limit per IP;
 *   a 429 doubles the delay (up to 1 min).
 * - it pauses while the tab is hidden and checks again as soon as it is visible;
 * - it stops after 20 minutes (the user can restart it);
 * - `onAuthStateChange` / `getSession` cover the link opened in this browser.
 */

const INTERVAL_MS = 10_000;
const MAX_INTERVAL_MS = 60_000;
const MAX_DURATION_MS = 20 * 60_000;

export type VerificationWatchStatus = 'waiting' | 'verified' | 'stopped' | 'failed';

function isRateLimited(error: AuthError) {
  return error.status === 429 || error.code === 'over_request_rate_limit';
}

export function useEmailVerificationWatch({
  email,
  password,
  captcha,
  onVerified
}: {
  email: string;
  password: string;
  captcha: Captcha;
  onVerified: () => void;
}) {
  const [status, setStatus] = useState<VerificationWatchStatus>('waiting');
  const [run, setRun] = useState(0);

  // Latest values for the timer callbacks without restarting the loop.
  const captchaRef = useRef(captcha);
  const onVerifiedRef = useRef(onVerified);
  useEffect(() => {
    captchaRef.current = captcha;
    onVerifiedRef.current = onVerified;
  });

  useEffect(() => {
    if (!password) return;
    const supabase = createClient();
    const startedAt = Date.now();
    let delay = INTERVAL_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    let done = false;

    const finish = (next: VerificationWatchStatus) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      setStatus(next);
      if (next === 'verified') onVerifiedRef.current();
    };

    const schedule = () => {
      clearTimeout(timer);
      if (done || document.visibilityState === 'hidden') return;
      timer = setTimeout(check, delay);
    };

    async function check() {
      if (done || inFlight || document.visibilityState === 'hidden') return;
      if (Date.now() - startedAt > MAX_DURATION_MS) return finish('stopped');
      inFlight = true;
      try {
        // Link opened in this browser (another tab): the session cookie is here.
        const { data } = await supabase.auth.getSession();
        if (data.session) return finish('verified');

        const current = captchaRef.current;
        // CAPTCHA on: wait for a fresh single-use token before calling Supabase.
        if (!current.ready) return;
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
          options: { captchaToken: current.captchaToken }
        });
        if (current.enabled) current.reset();

        if (!error) return finish('verified');
        if (error.code === 'email_not_confirmed') {
          delay = INTERVAL_MS;
        } else if (isRateLimited(error)) {
          delay = Math.min(delay * 2, MAX_INTERVAL_MS);
        } else if (error.code === 'invalid_credentials') {
          // Password changed meanwhile: a normal sign-in is needed.
          return finish('failed');
        } else {
          delay = Math.min(delay * 2, MAX_INTERVAL_MS);
        }
      } catch {
        delay = Math.min(delay * 2, MAX_INTERVAL_MS);
      } finally {
        inFlight = false;
        schedule();
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void check();
      else clearTimeout(timer);
    };
    document.addEventListener('visibilitychange', onVisibility);

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) finish('verified');
    });

    // "Check now" checks right away; the first run waits one interval.
    if (run > 0) void check();
    else schedule();
    return () => {
      done = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      subscription.unsubscribe();
    };
  }, [email, password, run]);

  const restart = useCallback(() => {
    setStatus('waiting');
    setRun((n) => n + 1);
  }, []);

  return { status, restart };
}

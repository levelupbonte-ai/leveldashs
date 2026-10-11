'use client';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icons } from '@/components/icons';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { signOutIdle } from '@/lib/auth/actions';

/** Last activity (ms since epoch), shared by every dashboard tab of this browser. */
const ACTIVITY_KEY = 'lu_last_activity';
const CHANNEL = 'lu-session';
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'];
/** Writes to localStorage at most this often (pointermove fires a lot). */
const WRITE_EVERY_MS = 15_000;
const CHECK_EVERY_MS = 1_000;

export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const IDLE_WARNING_MS = 2 * 60 * 1000;

type Message = { type: 'activity'; at: number } | { type: 'signed-out' };

function readActivity(): number {
  try {
    const value = Number(window.localStorage.getItem(ACTIVITY_KEY));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

function writeActivity(at: number) {
  try {
    window.localStorage.setItem(ACTIVITY_KEY, String(at));
  } catch {
    // Private mode / blocked storage: this tab still tracks its own activity.
  }
}

/**
 * Signs the dashboard out after `timeoutMs` without activity in any tab, with a
 * "Stay signed in" warning `warningMs` before. Tabs share the last activity time
 * (localStorage + `storage` event) and the sign-out (BroadcastChannel), so working
 * in one tab keeps the others alive and signing out closes them all. The server
 * still re-validates every request (`getUser()` in the proxy).
 */
export function IdleTimeout({
  timeoutMs = IDLE_TIMEOUT_MS,
  warningMs = IDLE_WARNING_MS
}: {
  timeoutMs?: number;
  warningMs?: number;
}) {
  const t = useTranslations('auth.idle');
  const lastActivity = useRef(0);
  const lastWrite = useRef(0);
  const channel = useRef<BroadcastChannel | null>(null);
  const signingOut = useRef(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const warning = remaining !== null;
  const warningRef = useRef(false);
  useEffect(() => {
    warningRef.current = warning;
  }, [warning]);

  const markActive = useCallback((force = false) => {
    const now = Date.now();
    lastActivity.current = now;
    if (force || now - lastWrite.current > WRITE_EVERY_MS) {
      lastWrite.current = now;
      writeActivity(now);
      channel.current?.postMessage({ type: 'activity', at: now } satisfies Message);
    }
  }, []);

  const endSession = useCallback(() => {
    if (signingOut.current) return;
    signingOut.current = true;
    channel.current?.postMessage({ type: 'signed-out' } satisfies Message);
    void signOutIdle().catch(() => window.location.assign('/auth/sign-in?reason=idle'));
  }, []);

  const check = useCallback(() => {
    if (signingOut.current) return;
    const last = Math.max(lastActivity.current, readActivity());
    lastActivity.current = last;
    const left = timeoutMs - (Date.now() - last);
    if (left <= 0) {
      endSession();
      return;
    }
    setRemaining(left <= warningMs ? left : null);
  }, [endSession, timeoutMs, warningMs]);

  useEffect(() => {
    // Opening a dashboard page is activity.
    markActive(true);
    try {
      channel.current = new BroadcastChannel(CHANNEL);
      channel.current.addEventListener('message', (event: MessageEvent<Message>) => {
        if (event.data?.type === 'signed-out') {
          signingOut.current = true;
          window.location.assign('/auth/sign-in?reason=idle');
        } else if (event.data?.type === 'activity') {
          lastActivity.current = Math.max(lastActivity.current, event.data.at);
          check();
        }
      });
    } catch {
      channel.current = null;
    }

    // While the warning is open only "Stay signed in" counts, so a stray mouse
    // move does not silently extend the session.
    const onActivity = () => {
      if (!warningRef.current) markActive();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === ACTIVITY_KEY) check();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    ACTIVITY_EVENTS.forEach((name) =>
      window.addEventListener(name, onActivity, { passive: true, capture: true })
    );
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    return () => {
      ACTIVITY_EVENTS.forEach((name) =>
        window.removeEventListener(name, onActivity, { capture: true })
      );
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
      channel.current?.close();
      channel.current = null;
    };
  }, [check, markActive]);

  const stay = () => {
    markActive(true);
    setRemaining(null);
  };

  const seconds = Math.max(0, Math.ceil((remaining ?? 0) / 1000));
  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  return (
    <AlertDialog open={warning} onOpenChange={(open) => !open && stay()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <Icons.clock aria-hidden />
          </AlertDialogMedia>
          <AlertDialogTitle>{t('title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t.rich('description', {
              time: () => (
                <strong className='text-foreground tabular-nums' aria-live='off'>
                  {time}
                </strong>
              )
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant='outline' onClick={endSession}>
            {t('signOut')}
          </Button>
          <AlertDialogAction autoFocus onClick={stay}>
            {t('stay')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

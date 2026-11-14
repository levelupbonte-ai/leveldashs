'use client';

import { useLocale } from 'next-intl';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export type PushState = 'loading' | 'unsupported' | 'unavailable' | 'denied' | 'off' | 'on';

function toBytes(base64url: string) {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registration() {
  return (
    (await navigator.serviceWorker.getRegistration('/')) ??
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
  );
}

/**
 * This device's push notifications for the team (new member, new message):
 * state, turn on (asks the browser, stores the subscription for the signed-in
 * user with staff_push_subscribe), turn off.
 */
export function usePush() {
  const locale = useLocale();
  const [state, setState] = useState<PushState>('loading');
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async (): Promise<PushState> => {
      if (
        !('serviceWorker' in navigator) ||
        !('PushManager' in window) ||
        !('Notification' in window)
      ) {
        return 'unsupported';
      }
      const res = await fetch('/api/push/key', { cache: 'no-store' }).catch(() => null);
      const publicKey = res?.ok
        ? ((await res.json()) as { publicKey: string | null }).publicKey
        : null;
      if (!cancelled) setKey(publicKey);
      if (!publicKey) return 'unavailable';
      if (Notification.permission === 'denied') return 'denied';
      const reg = await navigator.serviceWorker.getRegistration('/');
      const sub = await reg?.pushManager.getSubscription();
      return sub ? 'on' : 'off';
    })()
      .then((next) => !cancelled && setState(next))
      .catch(() => !cancelled && setState('unsupported'));
    return () => {
      cancelled = true;
    };
  }, []);

  /** Resolves to true once this device receives the notifications. */
  const enable = async (): Promise<boolean> => {
    if (!key) return false;
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off');
        return false;
      }
      const reg = await registration();
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: toBytes(key)
        }));
      const { error } = await createClient().rpc('staff_push_subscribe', {
        p_sub: sub.toJSON(),
        p_locale: locale === 'fr' ? 'fr' : 'en'
      });
      if (error) throw error;
      setState('on');
      return true;
    } catch {
      return false;
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration('/');
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await createClient().rpc('staff_push_unsubscribe', { p_endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setState('off');
    } finally {
      setBusy(false);
    }
  };

  return { state, busy, enable, disable };
}

'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';

type State = 'loading' | 'unsupported' | 'unavailable' | 'denied' | 'off' | 'on';

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
 * Push notifications on this device for the team: new member, new message.
 * The browser asks for permission; the subscription is stored for the signed-in
 * user (staff_push_subscribe) and only editors+ of the site get notified.
 */
export function PushToggle() {
  const t = useTranslations('clientPortal.push');
  const locale = useLocale();
  const [state, setState] = useState<State>('loading');
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (
        !('serviceWorker' in navigator) ||
        !('PushManager' in window) ||
        !('Notification' in window)
      ) {
        return 'unsupported' as const;
      }
      const res = await fetch('/api/push/key', { cache: 'no-store' }).catch(() => null);
      const publicKey = res?.ok
        ? ((await res.json()) as { publicKey: string | null }).publicKey
        : null;
      if (cancelled) return null;
      setKey(publicKey);
      if (!publicKey) return 'unavailable' as const;
      if (Notification.permission === 'denied') return 'denied' as const;
      const reg = await navigator.serviceWorker.getRegistration('/');
      const sub = await reg?.pushManager.getSubscription();
      return sub ? ('on' as const) : ('off' as const);
    })()
      .then((next) => {
        if (!cancelled && next) setState(next);
      })
      .catch(() => !cancelled && setState('unsupported'));
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = async () => {
    if (!key) return;
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off');
        return;
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
      toast.success(t('enabled'));
    } catch {
      toast.error(t('unsupported'));
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
      toast.success(t('disabled'));
    } finally {
      setBusy(false);
    }
  };

  if (state === 'loading' || state === 'unavailable') return null;

  return (
    <div className='flex flex-wrap items-center gap-3 rounded-lg border p-3'>
      <span className='bg-muted grid size-9 shrink-0 place-items-center rounded-lg'>
        <Icons.notification className='size-4' aria-hidden />
      </span>
      <div className='min-w-0 flex-1'>
        <p className='text-sm font-medium'>{state === 'on' ? t('on') : t('title')}</p>
        <p className='text-muted-foreground text-xs'>
          {state === 'denied'
            ? t('denied')
            : state === 'unsupported'
              ? t('unsupported')
              : t('description')}
        </p>
      </div>
      {state === 'off' && (
        <Button size='sm' onClick={() => void enable()} disabled={busy}>
          {t('off')}
        </Button>
      )}
      {state === 'on' && (
        <Button size='sm' variant='ghost' onClick={() => void disable()} disabled={busy}>
          {t('turnOff')}
        </Button>
      )}
    </div>
  );
}

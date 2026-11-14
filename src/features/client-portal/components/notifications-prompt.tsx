'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useDashboardSession } from '@/lib/auth/session-context';
import { hasRole } from '@/lib/auth/types';
import { usePush } from './use-push';

const DISMISS_KEY = 'lu-push-prompt-dismissed';
const ASK_AGAIN_MS = 3 * 24 * 3600 * 1000;

function dismissedRecently() {
  try {
    return Date.now() - Number(localStorage.getItem(DISMISS_KEY) || 0) < ASK_AGAIN_MS;
  } catch {
    return false;
  }
}

/**
 * Invitation to turn on notifications (new member, new message), shown on any
 * dashboard page to the team of a site with a client space, until they are on
 * on this device. "Later" asks again in 3 days.
 */
export function NotificationsPrompt() {
  const { activeOrg, activeWebsite } = useDashboardSession();
  const eligible =
    !!activeOrg?.role &&
    hasRole(activeOrg.role, 'editor') &&
    !!activeWebsite?.features.includes('client_portal');
  if (!eligible) return null;
  return <Prompt />;
}

function Prompt() {
  const t = useTranslations('clientPortal.push');
  const { state, busy, enable } = usePush();
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    // After the first paint: the browser storage is only read on the device.
    const timer = setTimeout(() => setHidden(dismissedRecently()), 1500);
    return () => clearTimeout(timer);
  }, []);

  if (hidden || state !== 'off') return null;

  const later = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // Private mode: it simply asks again next time.
    }
    setHidden(true);
  };

  return (
    <div
      role='dialog'
      aria-labelledby='lu-push-prompt-title'
      className='bg-popover text-popover-foreground fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-50 mx-auto max-w-md rounded-2xl border p-4 shadow-xl sm:right-4 sm:left-auto'
    >
      <div className='flex gap-3'>
        <span className='bg-primary text-primary-foreground grid size-10 shrink-0 place-items-center rounded-xl'>
          <Icons.notification className='size-5' aria-hidden />
        </span>
        <div className='min-w-0 flex-1 space-y-1'>
          <p id='lu-push-prompt-title' className='text-sm font-semibold'>
            {t('promptTitle')}
          </p>
          <p className='text-muted-foreground text-xs leading-relaxed'>{t('promptBody')}</p>
        </div>
      </div>
      <div className='mt-3 flex justify-end gap-2'>
        <Button size='sm' variant='ghost' onClick={later}>
          {t('later')}
        </Button>
        <Button
          size='sm'
          disabled={busy}
          onClick={() =>
            void enable().then((ok) => {
              if (ok) toast.success(t('enabled'));
              else later();
            })
          }
        >
          {t('enable')}
        </Button>
      </div>
    </div>
  );
}

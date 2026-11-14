'use client';

import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { usePush } from './use-push';

/** Notifications card of the Messages tab: on / off for this device. */
export function PushToggle() {
  const t = useTranslations('clientPortal.push');
  const { state, busy, enable, disable } = usePush();

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
        <Button
          size='sm'
          disabled={busy}
          onClick={() => void enable().then((ok) => (ok ? toast.success(t('enabled')) : undefined))}
        >
          {t('off')}
        </Button>
      )}
      {state === 'on' && (
        <Button
          size='sm'
          variant='ghost'
          disabled={busy}
          onClick={() => void disable().then(() => toast.success(t('disabled')))}
        >
          {t('turnOff')}
        </Button>
      )}
    </div>
  );
}

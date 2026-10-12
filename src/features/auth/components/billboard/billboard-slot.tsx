'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { cn } from '@/lib/utils';

// Separate chunks, fetched only once the form is interactive and only on desktop.
const ParticleStar = dynamic(() => import('./particle-star'), { ssr: false });
const ShowcaseDeck = dynamic(() => import('./showcase-deck'), { ssr: false });

const DESKTOP = '(min-width: 1024px)';

/**
 * Desktop (>= lg) and idle: false on the server, on phones and tablets and until
 * the browser has nothing better to do, so none of the billboard JS (or its
 * images) competes with the sign-in form.
 */
function useBillboardReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const markReady = () => setReady(true);
    const mql = window.matchMedia(DESKTOP);
    let idle = 0;
    let timer = 0;
    const arm = () => {
      if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idle);
      window.clearTimeout(timer);
      if (!mql.matches) {
        setReady(false);
        return;
      }
      if (typeof window.requestIdleCallback === 'function')
        idle = window.requestIdleCallback(markReady, { timeout: 1500 });
      else timer = window.setTimeout(markReady, 400);
    };
    arm();
    mql.addEventListener('change', arm);
    return () => {
      mql.removeEventListener('change', arm);
      if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idle);
      window.clearTimeout(timer);
    };
  }, []);
  return ready;
}

export function StarSlot({ className }: { className?: string }) {
  const ready = useBillboardReady();
  return (
    <div className={cn('relative', className)} aria-hidden>
      {/* Static star while the canvas loads (and as its backdrop): no layout shift. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src='/icon.svg'
        alt=''
        width={512}
        height={512}
        loading='lazy'
        className={cn(
          'absolute inset-0 m-auto h-[62%] w-[62%] object-contain transition-opacity duration-700',
          ready ? 'opacity-0' : 'opacity-80'
        )}
      />
      {ready && <ParticleStar className='absolute inset-0 animate-in fade-in duration-700' />}
    </div>
  );
}

export function DeckSlot({ className }: { className?: string }) {
  const ready = useBillboardReady();
  return (
    <div className={cn('flex min-h-[236px] flex-1 flex-col justify-center', className)}>
      {ready && <ShowcaseDeck />}
    </div>
  );
}

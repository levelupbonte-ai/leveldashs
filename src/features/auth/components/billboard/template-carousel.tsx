'use client';

import { useEffect, useRef } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import { SceneClock, useClockValue } from './scene-clock';

export const TEMPLATE_MS = 4200;

const TEMPLATES = [
  {
    id: 'beauty',
    name: 'Miss Beauty',
    host: 'missbeauty.levelup-ecosystem.com',
    src: '/billboard/missbeauty.webp',
    label: 'tplBeauty'
  },
  {
    id: 'resto',
    name: 'Taste of Egypt Cafe',
    host: 'resto.levelup-ecosystem.com',
    src: '/billboard/resto.webp',
    label: 'tplResto'
  },
  {
    id: 'travel',
    name: 'LevelFlight Travel',
    host: 'travel.levelup-ecosystem.com',
    src: '/billboard/travel.webp',
    label: 'tplTravel'
  }
] as const;

export const TEMPLATE_COUNT = TEMPLATES.length;

const smooth = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

function activeIndex(t: number) {
  return Math.min(TEMPLATE_COUNT - 1, Math.floor(t / TEMPLATE_MS));
}

/**
 * Real templates in browser frames, cover-flow style: the active site slowly
 * scrolls, the previous and next ones wait on the sides.
 */
export default function TemplateCarousel({
  clock,
  active,
  reduced
}: {
  clock: SceneClock;
  active: boolean;
  reduced: boolean;
}) {
  const t = useTranslations('auth.shell');
  const idx = useClockValue(clock, (ms) => activeIndex(ms));
  const rootRef = useRef<HTMLDivElement>(null);

  // Auto-scroll of the active site: one custom property, read by the image transform.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const write = (ms: number) => {
      const local = reduced || !active ? 0 : (ms % TEMPLATE_MS) / TEMPLATE_MS;
      root.style.setProperty('--bb-scroll', smooth((local - 0.18) / 0.72).toFixed(4));
    };
    write(clock.t);
    return clock.onFrame(write);
  }, [clock, active, reduced]);

  const rels = TEMPLATES.map((_, i) => ((i - idx + TEMPLATE_COUNT + 1) % TEMPLATE_COUNT) - 1);
  return (
    <div ref={rootRef} className='relative h-full w-full'>
      {TEMPLATES.map((tpl, i) => {
        const rel = rels[i];
        const current = rel === 0;
        const name = tpl.name;
        return (
          <div
            key={tpl.id}
            aria-hidden={!current || undefined}
            data-current={current || undefined}
            className={cn(
              'bb-card absolute top-0 left-1/2 aspect-[16/11] h-full will-change-transform',
              rel !== 1 &&
                'transition-[transform,opacity] duration-[900ms] ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none',
              rel === 1 && 'bb-card-wrap',
              current ? 'z-20' : 'z-10'
            )}
            style={{
              transform: `translateX(${-50 + rel * 60}%) scale(${current ? 1 : 0.82})`,
              opacity: current ? 1 : 0.5
            }}
          >
            <a
              href={`https://${tpl.host}`}
              target='_blank'
              rel='noopener noreferrer'
              tabIndex={current ? 0 : -1}
              aria-label={t('tplOpen', { name })}
              className={cn(
                'bb-frame group/frame bg-card flex h-full flex-col overflow-hidden rounded-xl border',
                'focus-visible:ring-ring/60 outline-none focus-visible:ring-2',
                !current && 'pointer-events-none'
              )}
            >
              <div className='bg-muted/70 flex h-7 shrink-0 items-center gap-2 border-b px-3'>
                <span className='flex gap-1' aria-hidden>
                  <i className='bg-foreground/15 size-2 rounded-full' />
                  <i className='bg-foreground/15 size-2 rounded-full' />
                  <i className='bg-foreground/15 size-2 rounded-full' />
                </span>
                <span className='bg-background/80 text-muted-foreground mx-auto flex h-4.5 max-w-[78%] min-w-0 flex-1 items-center justify-center gap-1 truncate rounded-md px-2 text-[10px] leading-none'>
                  <Icons.lock className='size-2.5 shrink-0' aria-hidden />
                  <span className='truncate'>{tpl.host}</span>
                </span>
              </div>
              <div className='bb-viewport relative min-h-0 flex-1 overflow-hidden bg-neutral-200 dark:bg-neutral-800'>
                <Image
                  src={tpl.src}
                  alt=''
                  width={880}
                  height={1100}
                  sizes='480px'
                  unoptimized
                  loading='eager'
                  fetchPriority='low'
                  draggable={false}
                  className='bb-shot absolute top-0 left-0 block h-auto w-full max-w-none select-none'
                />
                <div className='bb-caption pointer-events-none absolute inset-x-2.5 bottom-2.5 flex items-center justify-between gap-2'>
                  <span className='flex min-w-0 items-center gap-2 rounded-full bg-black/70 py-1 pr-3 pl-1 text-white shadow-lg backdrop-blur-md'>
                    <span className='grid size-5 shrink-0 place-items-center rounded-full bg-white/15 text-[9px] font-semibold'>
                      {name.slice(0, 1)}
                    </span>
                    <span className='truncate text-[11px] font-medium'>{name}</span>
                    <span className='hidden truncate text-[10px] text-white/60 xl:inline'>
                      {t(tpl.label)}
                    </span>
                  </span>
                  <span className='grid size-6 shrink-0 place-items-center rounded-full bg-white text-black opacity-0 shadow-lg transition-opacity group-hover/frame:opacity-100 group-focus-visible/frame:opacity-100'>
                    <Icons.externalLink className='size-3' aria-hidden />
                  </span>
                </div>
              </div>
            </a>
          </div>
        );
      })}
    </div>
  );
}

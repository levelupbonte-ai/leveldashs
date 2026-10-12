'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { SceneClock } from './scene-clock';
import StudioDemo, { DEMO_MS } from './studio-demo';
import TemplateCarousel, { TEMPLATE_COUNT, TEMPLATE_MS } from './template-carousel';
import { usePrefersReducedMotion } from './use-reduced-motion';

const DURATION = [TEMPLATE_COUNT * TEMPLATE_MS, DEMO_MS] as const;

/**
 * The rotating cards of the billboard: our real templates, then LevelStudio's AI
 * demo, on one clock. Pauses off screen and in hidden tabs; under
 * prefers-reduced-motion nothing moves by itself (the tabs still work).
 */
export default function ShowcaseDeck() {
  const t = useTranslations('auth.shell');
  const reduced = usePrefersReducedMotion();
  const clock = useMemo(() => new SceneClock(), []);
  const [scene, setScene] = useState(0);
  const sceneRef = useRef(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const barRefs = useRef<(HTMLSpanElement | null)[]>([]);

  const select = useCallback(
    (next: number, at = 0) => {
      sceneRef.current = next;
      setScene(next);
      clock.set(at);
    },
    [clock]
  );

  // Progress bar under the active tab: a transform written once per frame.
  useEffect(() => {
    return clock.onFrame((ms) => {
      barRefs.current.forEach((bar, i) => {
        if (!bar) return;
        const p = i === sceneRef.current && !reduced ? ms / DURATION[i] : 0;
        bar.style.transform = `scaleX(${Math.min(1, p).toFixed(4)})`;
      });
    });
  }, [clock, reduced]);

  useEffect(() => {
    if (reduced) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    let raf = 0;
    let last = 0;
    let running = false;
    let visible = false;
    const frame = (now: number) => {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      const dt = last ? Math.min(64, now - last) : 16.7;
      last = now;
      const next = clock.t + dt;
      if (next >= DURATION[sceneRef.current]) select((sceneRef.current + 1) % DURATION.length);
      else clock.set(next);
    };
    const start = () => {
      if (running || !visible || document.hidden) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) start();
      else stop();
    });
    io.observe(wrap);
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [clock, reduced, select]);

  const tabs = [t('tabTemplates'), t('tabStudio')];

  return (
    <div
      ref={wrapRef}
      role='region'
      aria-label={t('deckLabel')}
      className='flex h-full max-h-[480px] min-h-0 flex-col gap-3.5'
    >
      <div className='flex items-center gap-1'>
        {tabs.map((label, i) => (
          <button
            key={i}
            type='button'
            aria-pressed={scene === i}
            onClick={() => select(i)}
            className={cn(
              'relative cursor-pointer rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
              'focus-visible:ring-ring/60 outline-none focus-visible:ring-2',
              scene === i
                ? 'bg-foreground/[0.07] text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {label}
            <span
              className={cn(
                'absolute inset-x-3 -bottom-px h-px origin-left overflow-hidden bg-transparent',
                scene !== i && 'hidden'
              )}
            >
              <span
                ref={(el) => {
                  barRefs.current[i] = el;
                }}
                className='bb-progress absolute inset-0 origin-left scale-x-0 rounded-full'
              />
            </span>
          </button>
        ))}
        {scene === 0 && (
          <span className='ml-auto flex gap-1.5' aria-hidden>
            {Array.from({ length: TEMPLATE_COUNT }, (_, i) => (
              <i key={i} className='bg-foreground/15 size-1 rounded-full' />
            ))}
          </span>
        )}
      </div>
      <div className='relative max-h-[440px] min-h-0 flex-1'>
        <div
          inert={scene !== 0}
          className={cn(
            'bb-fade-x absolute inset-x-0 -top-4 -bottom-7 pt-4 pb-7 transition-[opacity,transform] duration-700 ease-out motion-reduce:transition-none',
            scene === 0
              ? 'translate-y-0 opacity-100'
              : 'pointer-events-none translate-y-2 opacity-0'
          )}
        >
          <div className='relative h-full'>
            <TemplateCarousel clock={clock} active={scene === 0} reduced={reduced} />
          </div>
        </div>
        <div
          inert={scene !== 1}
          className={cn(
            'absolute inset-0 transition-[opacity,transform] duration-700 ease-out motion-reduce:transition-none',
            scene === 1
              ? 'translate-y-0 opacity-100'
              : 'pointer-events-none translate-y-2 opacity-0'
          )}
        >
          <StudioDemo clock={clock} active={scene === 1} reduced={reduced} />
        </div>
      </div>
    </div>
  );
}

'use client';

import { createContext, Fragment, useContext, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import { SceneClock, useClockValue } from './scene-clock';

/**
 * Looping motion demo of LevelStudio's AI: a brief is typed and sent, the answer
 * streams in, the steps tick off and the website draft builds in the preview.
 * Always dark, like the real LevelStudio (violet on obsidian), in any theme.
 */

export const DEMO_MS = 14500;

const CUE = {
  send: 3300,
  skeleton: 3500,
  think: 3600,
  answerStart: 4200,
  answerEnd: 7500,
  steps: 7800,
  step1: 8600,
  step2: 10000,
  step3: 11300,
  ready: 12300,
  nav: 5600,
  hero: 6800,
  image: 8000,
  services: 9200,
  cta: 10400
} as const;
const TYPE = { start: 500, end: 3000 } as const;

const FACETS: [string, string][] = [
  ['256,278 256,38 202,192', '#BA97FE'],
  ['256,278 256,38 310,192', '#7A31EE'],
  ['256,278 310,192 484,204', '#681FE1'],
  ['256,278 484,204 344,280', '#460DB7'],
  ['256,278 344,280 397,470', '#3A0897'],
  ['256,278 397,470 256,362', '#480DB7'],
  ['256,278 256,362 115,470', '#5C15CC'],
  ['256,278 115,470 168,280', '#6E22E1'],
  ['256,278 168,280 28,204', '#8941F7'],
  ['256,278 28,204 202,192', '#A974FE']
];

/** LevelStudio mark: the LevelUp star inside four frame brackets. */
function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox='0 0 512 512' className={className} aria-hidden>
      <g fill='none' stroke='#8B5CF6' strokeWidth='22' strokeLinecap='square'>
        <path d='M 64 144 L 64 64 L 144 64' />
        <path d='M 368 64 L 448 64 L 448 144' />
        <path d='M 64 368 L 64 448 L 144 448' />
        <path d='M 368 448 L 448 448 L 448 368' />
      </g>
      <g transform='translate(256, 256) scale(0.44) translate(-256, -256)'>
        {FACETS.map(([p, f]) => (
          <polygon key={p} points={p} fill={f} />
        ))}
      </g>
    </svg>
  );
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** "text with **bold** words" -> segments. */
function segments(text: string) {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((s) =>
      s.startsWith('**') ? { text: s.slice(2, -2), bold: true } : { text: s, bold: false }
    );
}

function Streamed({ text, chars }: { text: string; chars: number }) {
  const segs = useMemo(() => {
    const parts = segments(text);
    return parts.map((s, i) => ({
      ...s,
      from: parts.slice(0, i).reduce((n, p) => n + p.text.length, 0)
    }));
  }, [text]);
  return (
    <>
      {segs.map((s, i) => {
        const shown = s.text.slice(0, Math.max(0, chars - s.from));
        if (!shown) return null;
        return s.bold ? (
          <strong key={i} className='font-semibold text-slate-100'>
            {shown}
          </strong>
        ) : (
          <Fragment key={i}>{shown}</Fragment>
        );
      })}
    </>
  );
}

/** A piece of the preview: shimmering placeholder first, the real thing fades in. */
/** Whether the preview already shows its placeholders (the brief has been sent). */
const Placeholders = createContext(false);

function Build({
  on,
  className,
  children
}: {
  on: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const placeholders = useContext(Placeholders);
  return (
    <div className={cn('relative', className)}>
      <div
        className={cn(
          'bb-shimmer absolute inset-0 rounded-md transition-opacity duration-500',
          (on || !placeholders) && 'opacity-0'
        )}
      />
      <div
        className={cn(
          'transition-[opacity,transform] duration-700 ease-out motion-reduce:transition-none',
          !on && 'translate-y-1.5 opacity-0'
        )}
      >
        {children}
      </div>
    </div>
  );
}

function Step({ label, state }: { label: string; state: 'wait' | 'run' | 'done' }) {
  return (
    <li
      className={cn(
        'flex items-center gap-1.5 text-[10px] leading-tight transition-[opacity,color] duration-500',
        state === 'wait' ? 'text-slate-600' : state === 'run' ? 'text-slate-300' : 'text-slate-400'
      )}
    >
      <span className='grid size-3.5 shrink-0 place-items-center'>
        {state === 'done' ? (
          <Icons.check className='size-3 text-violet-400' aria-hidden />
        ) : state === 'run' ? (
          <Icons.spinner className='size-3 animate-spin text-violet-300' aria-hidden />
        ) : (
          <i className='size-1.5 rounded-full bg-slate-700' />
        )}
      </span>
      {label}
    </li>
  );
}

const step = (done: boolean, run: boolean) =>
  (done ? 'done' : run ? 'run' : 'wait') as 'wait' | 'run' | 'done';

export default function StudioDemo({
  clock,
  active,
  reduced
}: {
  clock: SceneClock;
  active: boolean;
  reduced: boolean;
}) {
  const t = useTranslations('auth.shell');
  const brief = t('demoBrief');
  const answer = t('demoAnswer');
  const plainLen = useMemo(() => segments(answer).reduce((n, s) => n + s.text.length, 0), [answer]);

  // The scene shows its first frame while inactive and its last one under reduced motion.
  const at = (ms: number) => (!active ? 0 : reduced ? DEMO_MS - 1 : ms);
  const typed = useClockValue(clock, (ms) =>
    Math.floor(clamp01((at(ms) - TYPE.start) / (TYPE.end - TYPE.start)) * brief.length)
  );
  const answered = useClockValue(clock, (ms) =>
    Math.floor(clamp01((at(ms) - CUE.answerStart) / (CUE.answerEnd - CUE.answerStart)) * plainLen)
  );
  const bits = useClockValue(clock, (ms) =>
    (Object.values(CUE) as number[]).map((c) => (at(ms) >= c ? '1' : '0')).join('')
  );
  const on = useMemo(() => {
    const keys = Object.keys(CUE) as (keyof typeof CUE)[];
    return Object.fromEntries(keys.map((k, i) => [k, bits[i] === '1'])) as Record<
      keyof typeof CUE,
      boolean
    >;
  }, [bits]);
  const typing = !on.send && typed > 0;
  const streaming = on.answerStart && !on.answerEnd;

  return (
    <div
      role='img'
      aria-label={t('demoLabel')}
      className='bb-studio mx-auto flex h-full w-full max-w-[640px] flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0B0B10] text-slate-200 shadow-2xl'
    >
      <div aria-hidden className='flex h-full min-h-0 flex-col'>
        {/* Header */}
        <div className='flex h-8 shrink-0 items-center gap-2 border-b border-white/10 bg-[#0E0E17] px-3'>
          <Mark className='size-4' />
          <span className='text-[11px] font-semibold tracking-tight text-slate-100'>
            LevelStudio
          </span>
          <span
            className={cn(
              'ml-auto inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[9.5px] transition-[opacity,background-color,color] duration-500',
              on.send ? 'opacity-100' : 'opacity-0',
              on.ready ? 'bg-emerald-400/15 text-emerald-300' : 'bg-violet-500/15 text-violet-200'
            )}
          >
            {on.ready ? (
              <Icons.check className='size-2.5' />
            ) : (
              <Icons.spinner className='size-2.5 animate-spin' />
            )}
            {on.ready ? t('demoReady') : t('demoWorking')}
          </span>
        </div>

        <div className='grid min-h-0 flex-1 grid-cols-[47fr_53fr]'>
          {/* Chat */}
          <div className='flex min-h-0 flex-col gap-2.5 p-3'>
            <div className='flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden'>
              <div
                className={cn(
                  'ml-auto max-w-[88%] rounded-2xl rounded-br-md bg-white/[0.08] px-2.5 py-1.5 text-[10.5px] leading-snug text-slate-100 transition-[opacity,transform] duration-500',
                  on.send ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
                )}
              >
                {brief}
              </div>
              <div
                className={cn(
                  'flex gap-2 transition-opacity duration-500',
                  on.think ? 'opacity-100' : 'opacity-0'
                )}
              >
                <Mark className='mt-0.5 size-4 shrink-0' />
                <div className='min-w-0 flex-1 text-[10.5px] leading-snug text-slate-300'>
                  {!on.answerStart ? (
                    <span className='bb-dots inline-flex gap-1 pt-1'>
                      <i />
                      <i />
                      <i />
                    </span>
                  ) : (
                    <p>
                      <Streamed text={answer} chars={answered} />
                      {streaming && <span className='bb-caret' />}
                    </p>
                  )}
                  <ul
                    className={cn(
                      'mt-2 space-y-1 transition-opacity duration-500',
                      on.steps ? 'opacity-100' : 'opacity-0'
                    )}
                  >
                    <Step label={t('demoStep1')} state={step(on.step2, on.steps)} />
                    <Step label={t('demoStep2')} state={step(on.step3, on.step2)} />
                    <Step label={t('demoStep3')} state={step(on.ready, on.step3)} />
                  </ul>
                </div>
              </div>
            </div>
            {/* Composer */}
            <div className='flex shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-[#13121F] py-1.5 pr-1.5 pl-2.5'>
              <Icons.add className='size-3 shrink-0 text-slate-500' />
              <span className='min-w-0 flex-1 truncate text-[10px] text-slate-400'>
                {typed > 0 && !on.send ? (
                  <>
                    <span className='text-slate-100'>{brief.slice(0, typed)}</span>
                    {typing && <span className='bb-caret' />}
                  </>
                ) : (
                  <span className='text-slate-500'>{t('demoPlaceholder')}</span>
                )}
              </span>
              <span
                className={cn(
                  'grid size-5 shrink-0 place-items-center rounded-full transition-colors duration-300',
                  typed > 0 && !on.send ? 'bg-white text-black' : 'bg-white/10 text-slate-500'
                )}
              >
                <Icons.arrowUp className='size-3' />
              </span>
            </div>
          </div>

          {/* Preview */}
          <div className='min-h-0 border-l border-white/10 bg-[#0E0E17] p-2.5'>
            <Placeholders.Provider value={on.skeleton}>
              <div className='flex h-full flex-col overflow-hidden rounded-lg bg-[#f6efe6] text-[#2b2118] shadow-lg'>
                <div className='flex h-4 shrink-0 items-center gap-1 bg-[#e9dfd1] px-2'>
                  <i className='size-1 rounded-full bg-[#2b2118]/25' />
                  <i className='size-1 rounded-full bg-[#2b2118]/25' />
                  <i className='size-1 rounded-full bg-[#2b2118]/25' />
                </div>
                <div className='flex min-h-0 flex-1 flex-col gap-2 p-2.5'>
                  <Build on={on.nav}>
                    <div className='flex items-center justify-between'>
                      <span className='font-serif text-[10px] font-bold'>Salon Aurore</span>
                      <span className='flex gap-2 text-[7px] tracking-wide uppercase opacity-70'>
                        <span>{t('demoNavHome')}</span>
                        <span>{t('demoNavServices')}</span>
                        <span>{t('demoNavBook')}</span>
                      </span>
                    </div>
                  </Build>
                  <div className='grid min-h-0 flex-1 grid-cols-[1.15fr_.85fr] gap-2'>
                    <Build on={on.hero} className='self-center'>
                      <p className='font-serif text-[15px] leading-[1.1] font-semibold'>
                        {t('demoSiteTag')}
                      </p>
                      <p className='mt-1 text-[7.5px] leading-snug opacity-70'>
                        {t('demoSiteSub')}
                      </p>
                      <Build on={on.cta} className='mt-2 inline-block'>
                        <span className='inline-block rounded-full bg-[#b5573a] px-2 py-1 text-[7.5px] font-medium text-white'>
                          {t('demoSiteCta')}
                        </span>
                      </Build>
                    </Build>
                    <Build on={on.image} className='min-h-0'>
                      <div className='relative mx-auto h-full max-h-[104px] min-h-[64px] w-[72%] overflow-hidden rounded-t-full bg-gradient-to-b from-[#e6b48f] to-[#b5573a]'>
                        <i className='absolute top-[22%] left-1/2 size-5 -translate-x-1/2 rounded-full bg-[#f6dcbc]/90' />
                        <i className='absolute inset-x-0 bottom-0 h-[38%] bg-[#8e3f27]/50' />
                      </div>
                    </Build>
                  </div>
                  <Build on={on.services}>
                    <div className='grid grid-cols-3 gap-1.5'>
                      {(['demoService1', 'demoService2', 'demoService3'] as const).map((k) => (
                        <div
                          key={k}
                          className='rounded-md border border-[#2b2118]/10 bg-white/60 px-1.5 py-1'
                        >
                          <p className='text-[8px] font-medium'>{t(k)}</p>
                          <i className='mt-0.5 block h-px w-4 bg-[#b5573a]/70' />
                        </div>
                      ))}
                    </div>
                  </Build>
                </div>
              </div>
            </Placeholders.Provider>
          </div>
        </div>
      </div>
    </div>
  );
}

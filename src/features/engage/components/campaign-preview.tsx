'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { CampaignKind, CampaignText, CampaignTheme } from '../api/types';

/**
 * What visitors will see, drawn like the LevelUp tag draws it (bar, pop-up or
 * inline card). Static: the countdown shows a sample value.
 */
export function CampaignPreview({
  kind,
  theme,
  accent,
  text,
  coupon,
  countdown,
  hasLink
}: {
  kind: CampaignKind;
  theme: CampaignTheme;
  accent: string;
  text: CampaignText;
  coupon: string;
  countdown: boolean;
  hasLink: boolean;
}) {
  const t = useTranslations('engage.campaigns.preview');
  const dark = theme !== 'light';
  const surface =
    theme === 'accent'
      ? { background: accent || '#c2410c', color: '#fff' }
      : theme === 'light'
        ? { background: '#fff', color: '#0b1220' }
        : { background: '#0b1220', color: '#fff' };
  const cta =
    accent && theme !== 'accent'
      ? { background: accent, color: '#fff' }
      : dark
        ? { background: '#fff', color: '#0b1220' }
        : { background: '#0b1220', color: '#fff' };
  const muted = dark ? 'opacity-80' : 'text-slate-600';

  const parts = (
    <>
      {text.title && <span className='font-bold'>{text.title}</span>}
      {text.text && <span className={muted}>{text.text}</span>}
      {countdown && (
        <span className='inline-flex gap-1 tabular-nums'>
          {['4', '11', '59', '20'].map((v, i) => (
            <span key={i} className='rounded-md bg-white/15 px-1.5 py-0.5 text-xs font-bold'>
              {v}
              <small className='ml-0.5 font-normal opacity-80'>
                {t(`units.${i}` as 'units.0')}
              </small>
            </span>
          ))}
        </span>
      )}
      {coupon && (
        <span className='inline-flex items-center gap-1.5 rounded-lg border border-dashed border-current/50 py-0.5 pr-0.5 pl-2 text-xs font-bold tracking-wider'>
          {coupon}
          <span className='rounded-md bg-white/15 px-1.5 py-0.5 font-medium'>{t('copy')}</span>
        </span>
      )}
      {hasLink && (
        <span
          className='inline-flex items-center rounded-full px-3 py-1 text-xs font-bold'
          style={cta}
        >
          {text.cta || t('cta')}
        </span>
      )}
    </>
  );

  return (
    <div className='bg-muted/40 relative overflow-hidden rounded-xl border' aria-label={t('label')}>
      <div className='text-muted-foreground px-3 pt-2 text-xs'>{t('title')}</div>
      <div className='relative h-56 p-3'>
        <div className='bg-background/70 space-y-2 rounded-md p-3'>
          <div className='bg-muted h-3 w-1/3 rounded' />
          <div className='bg-muted h-2 w-2/3 rounded' />
          <div className='bg-muted h-2 w-1/2 rounded' />
        </div>
        {kind === 'bar' && (
          <div
            className='absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-center gap-2 px-8 py-2 text-xs shadow-lg'
            style={surface}
          >
            {parts}
            <span className='absolute right-2 text-base leading-none' aria-hidden>
              ×
            </span>
          </div>
        )}
        {kind === 'popup' && (
          <div className='absolute inset-0 flex items-center justify-center bg-black/40 p-4'>
            <div
              className='relative grid max-w-[260px] justify-items-center gap-2 rounded-2xl px-4 pt-5 pb-4 text-center text-xs shadow-xl'
              style={surface}
            >
              <span className='absolute top-1.5 right-2.5 text-base leading-none' aria-hidden>
                ×
              </span>
              {parts}
            </div>
          </div>
        )}
        {kind === 'slot' && (
          <div
            className={cn(
              'absolute inset-x-3 bottom-3 grid gap-1.5 rounded-xl p-3 text-xs',
              !dark && 'border'
            )}
            style={surface}
          >
            {parts}
          </div>
        )}
      </div>
    </div>
  );
}

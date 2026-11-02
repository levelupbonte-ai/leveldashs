'use client';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * The e-mail exactly as it will be sent, in a sandboxed frame (no scripts, no
 * same-origin access): what users typed is already escaped by the renderer,
 * and the frame keeps the preview's styles away from the dashboard.
 */
export function EmailFrame({
  html,
  title,
  className
}: {
  html: string;
  title: string;
  className?: string;
}) {
  return (
    <iframe
      title={title}
      srcDoc={html}
      sandbox=''
      referrerPolicy='no-referrer'
      className={cn('block h-full w-full border-0 bg-white', className)}
    />
  );
}

/** Desktop / phone preview switch around the frame. */
export function EmailPreview({ html }: { html: string }) {
  const t = useTranslations('emailCampaigns.editor');
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  return (
    <div className='space-y-3'>
      <div className='flex items-center justify-between gap-2'>
        <p className='text-sm font-medium'>{t('preview')}</p>
        <div className='flex gap-1' role='group' aria-label={t('previewDevice')}>
          {(['desktop', 'mobile'] as const).map((d) => {
            const Icon = d === 'desktop' ? Icons.laptop : Icons.phone;
            return (
              <Button
                key={d}
                type='button'
                size='sm'
                variant={device === d ? 'secondary' : 'ghost'}
                aria-pressed={device === d}
                onClick={() => setDevice(d)}
              >
                <Icon className='size-4' aria-hidden />
                {t(d)}
              </Button>
            );
          })}
        </div>
      </div>
      <div className='bg-muted/40 flex justify-center overflow-hidden rounded-xl border p-3'>
        <div
          className={cn(
            'overflow-hidden rounded-lg border bg-white shadow-sm transition-[width]',
            device === 'desktop'
              ? 'h-[720px] w-full max-w-[680px]'
              : 'h-[680px] w-[375px] max-w-full rounded-[28px] border-4'
          )}
        >
          <EmailFrame html={html} title={t('preview')} />
        </div>
      </div>
    </div>
  );
}

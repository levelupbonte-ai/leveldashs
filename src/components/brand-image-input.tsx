'use client';
import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useErrorMessage } from '@/hooks/use-error-message';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { uploadBrandImage } from '@/lib/brand-images';
import { cn } from '@/lib/utils';

/** Avatar / logo picker: preview, upload (resized in the browser) and removal. */
export function BrandImageInput({
  value,
  onChange,
  folder,
  label,
  fallback,
  rounded = 'full'
}: {
  value: string | null;
  onChange: (url: string | null) => void | Promise<void>;
  folder: string;
  label: string;
  fallback: string;
  rounded?: 'full' | 'lg';
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const t = useTranslations('brandImage');
  const errorMessage = useErrorMessage();

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      await onChange(await uploadBrandImage(file, folder));
    } catch (e) {
      toast.error(errorMessage(e, 'uploadFailed'));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className='flex items-center gap-4'>
      <div
        className={cn(
          'bg-muted text-muted-foreground grid size-16 shrink-0 place-items-center overflow-hidden border text-lg font-semibold',
          rounded === 'full' ? 'rounded-full' : 'rounded-lg'
        )}
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt={label} className='size-full object-cover' />
        ) : (
          fallback.slice(0, 2).toUpperCase()
        )}
      </div>
      <div className='space-y-1.5'>
        <p className='text-sm font-medium'>{label}</p>
        <div className='flex gap-2'>
          <Button
            type='button'
            size='sm'
            variant='outline'
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            {busy ? (
              <Icons.spinner className='size-4 animate-spin' />
            ) : (
              <Icons.upload className='size-4' />
            )}
            {value ? t('change') : t('upload')}
          </Button>
          {value && (
            <Button
              type='button'
              size='sm'
              variant='ghost'
              disabled={busy}
              onClick={() => void onChange(null)}
            >
              {t('remove')}
            </Button>
          )}
        </div>
        <p className='text-muted-foreground text-xs'>{t('hint')}</p>
      </div>
      <input
        ref={input}
        type='file'
        accept='image/png,image/jpeg,image/webp'
        className='hidden'
        aria-label={label}
        onChange={(e) => void pick(e.target.files?.[0])}
      />
    </div>
  );
}

'use client';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

/** URL input with an "Upload" button that stores the file in the site's media library. */
export function ImageInput({
  id,
  value,
  onChange,
  onUpload,
  invalid,
  disabled
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onUpload: (file: File) => Promise<string>;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const t = useTranslations('site.content');

  return (
    <div className='space-y-2'>
      {value.startsWith('https://') && (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary storage/remote URLs
        <img src={value} alt='' className='bg-muted h-32 w-full rounded-md border object-cover' />
      )}
      <div className='flex gap-2'>
        <Input
          id={id}
          value={value}
          placeholder='https://…'
          aria-invalid={invalid}
          disabled={disabled || uploading}
          onChange={(e) => onChange(e.target.value)}
        />
        <Button
          type='button'
          variant='outline'
          disabled={disabled || uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? (
            <Icons.spinner className='size-4 animate-spin' />
          ) : (
            <Icons.upload className='size-4' />
          )}
          <span className='sr-only sm:not-sr-only'>{t('upload')}</span>
        </Button>
        <input
          ref={fileRef}
          type='file'
          aria-label={t('chooseImage')}
          accept='image/jpeg,image/png,image/webp,image/gif,image/avif'
          className='hidden'
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            setUploading(true);
            try {
              onChange(await onUpload(file));
            } catch {
              // the mutation already shows a toast
            } finally {
              setUploading(false);
            }
          }}
        />
      </div>
    </div>
  );
}

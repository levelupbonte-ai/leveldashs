'use client';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ImageInput } from './image-input';

/** An ordered list of images (gallery): thumbnails with move / remove, plus one input to add. */
export function ImagesInput({
  id,
  value,
  onChange,
  onUpload,
  invalid,
  max = 12
}: {
  id: string;
  value: string[];
  onChange: (value: string[]) => void;
  onUpload: (file: File) => Promise<string>;
  invalid?: boolean;
  max?: number;
}) {
  const t = useTranslations('site.content');
  const [draft, setDraft] = useState('');

  const add = (url: string) => {
    const clean = url.trim();
    if (!clean || value.includes(clean) || value.length >= max) return;
    onChange([...value, clean]);
    setDraft('');
  };
  const move = (from: number, to: number) => {
    const next = [...value];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };

  return (
    <div className='space-y-3'>
      {value.length > 0 && (
        <ol className='grid grid-cols-2 gap-2 sm:grid-cols-3'>
          {value.map((url, i) => (
            <li key={url} className='bg-muted relative overflow-hidden rounded-md border'>
              {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary storage/remote URLs */}
              <img src={url} alt='' className='aspect-[4/3] w-full object-cover' loading='lazy' />
              <div className='bg-background/85 absolute inset-x-0 bottom-0 flex justify-between p-1'>
                <span className='text-muted-foreground px-1 text-xs tabular-nums'>{i + 1}</span>
                <div className='flex gap-0.5'>
                  <Button
                    type='button'
                    size='icon'
                    variant='ghost'
                    className='size-6'
                    aria-label={t('moveUp')}
                    disabled={i === 0}
                    onClick={() => move(i, i - 1)}
                  >
                    <Icons.chevronLeft className='size-3.5' />
                  </Button>
                  <Button
                    type='button'
                    size='icon'
                    variant='ghost'
                    className='size-6'
                    aria-label={t('moveDown')}
                    disabled={i === value.length - 1}
                    onClick={() => move(i, i + 1)}
                  >
                    <Icons.chevronRight className='size-3.5' />
                  </Button>
                  <Button
                    type='button'
                    size='icon'
                    variant='ghost'
                    className='size-6'
                    aria-label={t('remove')}
                    onClick={() => onChange(value.filter((_, k) => k !== i))}
                  >
                    <Icons.close className='size-3.5' />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
      {value.length < max && (
        <div className='flex items-start gap-2'>
          <div className='flex-1'>
            <ImageInput
              id={id}
              value={draft}
              onChange={setDraft}
              onUpload={async (file) => {
                add(await onUpload(file));
                return '';
              }}
              invalid={invalid}
              preview={false}
            />
          </div>
          <Button
            type='button'
            variant='secondary'
            disabled={!/^https:\/\/\S+$/.test(draft.trim())}
            onClick={() => add(draft)}
          >
            <Icons.add className='size-4' />
            <span className='sr-only sm:not-sr-only'>{t('addImage')}</span>
          </Button>
        </div>
      )}
    </div>
  );
}

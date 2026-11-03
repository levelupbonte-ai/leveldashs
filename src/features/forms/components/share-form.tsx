'use client';
import { useTranslations } from 'next-intl';
import { useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const subscribe = () => () => {};

/** Link and copy-paste button of a published form (the page is hosted by LevelUp). */
export function ShareForm({
  publicId,
  published
}: {
  publicId: string | null;
  published: boolean;
}) {
  const t = useTranslations('siteForms.share');
  const origin = useSyncExternalStore(
    subscribe,
    () => window.location.origin,
    () => ''
  );
  if (!publicId || !published) {
    return (
      <Alert>
        <Icons.info className='size-4' aria-hidden />
        <AlertDescription>{t('publishFirst')}</AlertDescription>
      </Alert>
    );
  }
  const url = `${origin}/f/${publicId}`;
  const button = `<a href="${url}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#111827;color:#fff;font:600 15px system-ui,sans-serif;text-decoration:none">${t('buttonText')}</a>`;
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t('copied'));
    } catch {
      toast.error(t('copyFailed'));
    }
  };
  return (
    <div className='grid gap-5'>
      <div className='grid gap-1.5'>
        <span className='text-sm font-medium'>{t('link')}</span>
        <div className='flex gap-2'>
          <Input
            readOnly
            value={url}
            className='font-mono text-xs'
            onFocus={(e) => e.target.select()}
          />
          <Button
            type='button'
            variant='outline'
            size='icon'
            className='size-9 shrink-0'
            onClick={() => copy(url)}
            aria-label={t('copyLink')}
          >
            <Icons.copy className='size-4' aria-hidden />
          </Button>
          <a
            href={url}
            target='_blank'
            rel='noopener noreferrer'
            aria-label={t('open')}
            className={buttonVariants({
              variant: 'outline',
              size: 'icon',
              className: 'size-9 shrink-0'
            })}
          >
            <Icons.externalLink className='size-4' aria-hidden />
          </a>
        </div>
        <p className='text-muted-foreground text-xs'>{t('linkHint')}</p>
      </div>
      <div className='grid gap-1.5'>
        <span className='text-sm font-medium'>{t('button')}</span>
        <pre className='bg-muted overflow-x-auto rounded-md p-3 text-xs whitespace-pre-wrap break-all'>
          {button}
        </pre>
        <div>
          <Button type='button' variant='outline' size='sm' onClick={() => copy(button)}>
            <Icons.copy className='size-3.5' aria-hidden />
            {t('copyButton')}
          </Button>
        </div>
        <p className='text-muted-foreground text-xs'>{t('buttonHint')}</p>
      </div>
      <Alert>
        <Icons.shieldCheck className='size-4' aria-hidden />
        <AlertDescription>{t('secure')}</AlertDescription>
      </Alert>
    </div>
  );
}

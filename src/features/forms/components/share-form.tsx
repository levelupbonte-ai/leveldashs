'use client';
import { useTranslations } from 'next-intl';
import { useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

const subscribe = () => () => {};

/** "https://Shop.example.com/page" -> "https://shop.example.com"; null when not an https site. */
export function toOrigin(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    return u.protocol === 'https:' && u.hostname.includes('.') ? u.origin.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Where the form may be shown inside a website (settings.embed_origins). */
function AllowedSites({
  origins,
  onChange,
  disabled
}: {
  origins: string[] | undefined;
  onChange: (next: string[] | undefined) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('siteForms.share');
  const [draft, setDraft] = useState((origins ?? []).join('\n'));
  const lines = draft
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const bad = lines.filter((l) => !toOrigin(l));
  return (
    <div className='grid gap-1.5'>
      <span className='text-sm font-medium'>{t('allowed')}</span>
      <Textarea
        rows={3}
        value={draft}
        disabled={disabled}
        placeholder='https://www.example.com'
        onChange={(e) => {
          setDraft(e.target.value);
          const next = [
            ...new Set(
              e.target.value
                .split('\n')
                .map(toOrigin)
                .filter((o): o is string => !!o)
            )
          ].slice(0, 10);
          onChange(next.length ? next : undefined);
        }}
      />
      {bad.length > 0 && (
        <p className='text-destructive text-xs'>{t('allowedInvalid', { sites: bad.join(', ') })}</p>
      )}
      <p className='text-muted-foreground text-xs'>{t('allowedHint')}</p>
    </div>
  );
}

/** Link, copy-paste button and embed code of a published form (hosted by LevelUp). */
export function ShareForm({
  publicId,
  published,
  origins,
  onOrigins,
  canEdit
}: {
  publicId: string | null;
  published: boolean;
  origins?: string[];
  onOrigins: (next: string[] | undefined) => void;
  canEdit: boolean;
}) {
  const t = useTranslations('siteForms.share');
  const origin = useSyncExternalStore(
    subscribe,
    () => window.location.origin,
    () => ''
  );
  if (!publicId || !published) {
    return (
      <div className='grid gap-5'>
        <Alert>
          <Icons.info className='size-4' aria-hidden />
          <AlertDescription>{t('publishFirst')}</AlertDescription>
        </Alert>
        <AllowedSites origins={origins} onChange={onOrigins} disabled={!canEdit} />
      </div>
    );
  }
  const url = `${origin}/f/${publicId}`;
  const button = `<a href="${url}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#111827;color:#fff;font:600 15px system-ui,sans-serif;text-decoration:none">${t('buttonText')}</a>`;
  const embed = `<div data-lu-embed="${publicId}"></div>\n<script src="${origin}/forms/embed.js" async></script>`;
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
      <div className='grid gap-1.5'>
        <span className='text-sm font-medium'>{t('embed')}</span>
        <pre className='bg-muted overflow-x-auto rounded-md p-3 text-xs whitespace-pre-wrap break-all'>
          {embed}
        </pre>
        <div>
          <Button type='button' variant='outline' size='sm' onClick={() => copy(embed)}>
            <Icons.copy className='size-3.5' aria-hidden />
            {t('copyEmbed')}
          </Button>
        </div>
        <p className='text-muted-foreground text-xs'>{t('embedHint')}</p>
        <p className='text-muted-foreground text-xs'>{t('embedTag')}</p>
      </div>
      <AllowedSites origins={origins} onChange={onOrigins} disabled={!canEdit} />
      <Alert>
        <Icons.shieldCheck className='size-4' aria-hidden />
        <AlertDescription>{t('secure')}</AlertDescription>
      </Alert>
    </div>
  );
}

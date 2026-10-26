'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

function useCopy() {
  const t = useTranslations('common');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(id);
  }, [copied]);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(t('copied'));
    } catch {
      toast.error(t('genericError'));
    }
  };
  return { copied, copy, label: t('copy') };
}

/** Copy button with a short "copied" check state. */
export function CopyButton({
  value,
  className,
  variant = 'ghost'
}: {
  value: string;
  className?: string;
  variant?: 'ghost' | 'outline';
}) {
  const { copied, copy, label } = useCopy();
  return (
    <Button
      type='button'
      size='icon'
      variant={variant}
      className={cn('size-8 shrink-0', className)}
      aria-label={label}
      onClick={() => copy(value)}
    >
      {copied ? (
        <Icons.check className='size-4 text-emerald-600 dark:text-emerald-400' />
      ) : (
        <Icons.copy className='size-4' />
      )}
    </Button>
  );
}

/** Dark code surface (same in light and dark mode) with a label and a copy button. */
export function CodeBlock({
  code,
  label,
  className
}: {
  code: string;
  label?: string;
  className?: string;
}) {
  const { copied, copy, label: copyLabel } = useCopy();
  return (
    <div
      className={cn(
        'max-w-full min-w-0 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-100 shadow-sm',
        className
      )}
    >
      <div className='flex items-center justify-between gap-2 border-b border-zinc-800 py-1 pr-1 pl-3'>
        <span className='truncate font-mono text-[11px] text-zinc-400'>{label}</span>
        <Button
          type='button'
          size='sm'
          variant='ghost'
          className='h-7 gap-1.5 px-2 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white'
          onClick={() => copy(code)}
        >
          {copied ? <Icons.check className='size-3.5' /> : <Icons.copy className='size-3.5' />}
          {copyLabel}
        </Button>
      </div>
      <pre className='overflow-x-auto p-3 text-xs leading-relaxed'>
        <code className='font-mono'>{code}</code>
      </pre>
    </div>
  );
}

/** A labelled single value (ID, URL, key) with a copy button. */
export function CopyField({ value, className }: { value: string; className?: string }) {
  return (
    <div className={cn('bg-muted/60 flex items-center gap-1 rounded-md border pl-2.5', className)}>
      <code className='min-w-0 flex-1 truncate py-1.5 font-mono text-xs' title={value}>
        {value}
      </code>
      <CopyButton value={value} />
    </div>
  );
}

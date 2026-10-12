import { BrandMark } from '@/components/brand-mark';
import { LocaleSwitcher } from '@/components/i18n/locale-switcher';
import { LegalLinks } from '@/components/legal-links';
import { cn } from '@/lib/utils';

export const LEVELUP_SITE = 'https://levelup-ecosystem.com';
export const SUPPORT_EMAIL = 'contact@levelup-ecosystem.com';

/**
 * Full-page LevelUp error layout (404, unexpected errors): brand mark, large code,
 * title, explanation, actions, then links back to LevelUp and support. Works in
 * server and client components (no hooks).
 */
export function ErrorScreen({
  code,
  eyebrow,
  title,
  description,
  actions,
  footer,
  reference,
  className
}: {
  code: string;
  eyebrow: string;
  title: string;
  description: string;
  actions: React.ReactNode;
  footer: React.ReactNode;
  /** Support reference (error digest), never the error message itself. */
  reference?: React.ReactNode;
  className?: string;
}) {
  return (
    <main
      className={cn(
        'bg-background relative isolate flex min-h-svh w-full flex-col items-center justify-center overflow-hidden px-4 py-16',
        className
      )}
    >
      <div
        aria-hidden
        className='from-primary/10 pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] bg-radial-[ellipse_at_top] to-transparent to-70%'
      />
      <div className='flex w-full max-w-md flex-col items-center text-center'>
        <BrandMark className='mb-8 size-11' />
        <p className='text-primary text-xs font-semibold tracking-[0.2em] uppercase'>{eyebrow}</p>
        <p
          aria-hidden
          className='from-foreground to-foreground/10 mt-2 bg-linear-to-b bg-clip-text text-[7rem] leading-none font-extrabold tracking-tight text-transparent tabular-nums sm:text-[9rem]'
        >
          {code}
        </p>
        <h1 className='mt-4 text-2xl font-semibold tracking-tight text-balance sm:text-3xl'>
          {title}
        </h1>
        <p className='text-muted-foreground mt-3 text-sm text-pretty sm:text-base'>{description}</p>
        <div className='mt-8 flex w-full flex-col justify-center gap-2 sm:w-auto sm:flex-row'>
          {actions}
        </div>
        {reference && <p className='text-muted-foreground mt-6 font-mono text-xs'>{reference}</p>}
        <nav className='text-muted-foreground mt-12 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm'>
          {footer}
        </nav>
        <LocaleSwitcher className='mt-4' />
        <LegalLinks className='mt-4' />
      </div>
    </main>
  );
}

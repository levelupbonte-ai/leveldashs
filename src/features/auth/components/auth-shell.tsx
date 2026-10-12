import { getTranslations } from 'next-intl/server';
import { Icons } from '@/components/icons';
import { BrandMark } from '@/components/brand-mark';
import { LocaleSwitcher } from '@/components/i18n/locale-switcher';
import { LegalLinks } from '@/components/legal-links';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { DeckSlot, StarSlot } from './billboard/billboard-slot';

const TEMPLATES_URL = 'https://levelup-ecosystem.com/#templates';
const STUDIO_URL = 'https://studio.levelup-ecosystem.com';

const accent = (chunks: React.ReactNode) => (
  <span className='bg-linear-to-r from-(--bb-violet) to-(--bb-violet-soft) bg-clip-text text-transparent'>
    {chunks}
  </span>
);

/**
 * Left panel, desktop only (hidden below lg): the LevelUp billboard. Copy, links and
 * the aurora are server-rendered (instant, no layout shift); the particle star and
 * the rotating cards (templates, AI demo) are lazy client chunks that only load on
 * desktop once the browser is idle (see billboard/billboard-slot.tsx).
 */
function Billboard({ t }: { t: Awaited<ReturnType<typeof getTranslations<'auth.shell'>>> }) {
  const points = [t('point1'), t('point2'), t('point3')];
  return (
    <div className='auth-billboard relative hidden flex-col overflow-hidden px-10 py-9 lg:sticky lg:top-0 lg:flex lg:h-dvh xl:px-12 xl:py-10 dark:border-r'>
      <div className='bg-sidebar absolute inset-0' />
      <div className='bb-aurora' aria-hidden>
        <i
          className='bb-blob -top-[18%] -right-[12%] size-[78%]'
          style={{
            background:
              'radial-gradient(closest-side, color-mix(in oklab, var(--bb-violet) 70%, transparent), transparent)'
          }}
        />
        <i
          className='bb-blob -bottom-[22%] -left-[18%] size-[70%]'
          style={{
            animationDelay: '-9s',
            animationDirection: 'alternate-reverse',
            background:
              'radial-gradient(closest-side, color-mix(in oklab, var(--bb-violet-soft) 55%, transparent), transparent)'
          }}
        />
      </div>
      <div className='bb-grid' aria-hidden />

      <div className='text-sidebar-foreground relative z-20 flex items-center text-lg font-medium'>
        <BrandMark className='mr-2 size-7' />
        LevelUp
      </div>

      <div className='text-sidebar-foreground relative z-20 mt-6 flex min-h-0 flex-1 flex-col justify-between gap-6'>
        <div className='grid grid-cols-[1fr_minmax(0,42%)] items-center gap-4'>
          <div className='space-y-4'>
            <p className='text-muted-foreground flex items-center gap-2 text-[11px] font-medium tracking-[0.14em] uppercase'>
              <i className='size-1.5 rounded-full bg-(--bb-violet)' aria-hidden />
              {t('eyebrow')}
            </p>
            <h2 className='text-[clamp(1.55rem,2.3vw,2.3rem)] leading-[1.08] font-semibold tracking-tight text-balance'>
              {t.rich('title', { accent })}
            </h2>
            <p className='text-muted-foreground max-w-[34ch] text-sm leading-relaxed'>
              {t('subtitle')}
            </p>
            <ul className='space-y-2 pt-1 [@media(max-height:800px)]:hidden'>
              {points.map((point) => (
                <li key={point} className='flex items-start gap-2.5 text-[13px] leading-snug'>
                  <span className='mt-px grid size-4 shrink-0 place-items-center rounded-full bg-(--bb-violet)/15 text-(--bb-violet)'>
                    <Icons.check className='size-2.5' aria-hidden strokeWidth={3} />
                  </span>
                  {point}
                </li>
              ))}
            </ul>
          </div>
          <StarSlot className='aspect-square w-full' />
        </div>

        <DeckSlot />

        <div className='flex flex-wrap items-center gap-3'>
          <a
            href={STUDIO_URL}
            className={cn(
              buttonVariants({ size: 'lg' }),
              'bg-(--bb-violet) text-white shadow-lg shadow-(--bb-violet)/25 hover:bg-(--bb-violet)/90'
            )}
          >
            {t('ctaStudio')}
            <Icons.arrowRight aria-hidden />
          </a>
          <a
            href={TEMPLATES_URL}
            className={cn(
              buttonVariants({ variant: 'outline', size: 'lg' }),
              'border-foreground/20 bg-transparent shadow-none hover:bg-foreground/5 dark:bg-transparent dark:hover:bg-foreground/10'
            )}
          >
            {t('ctaTemplates')}
          </a>
        </div>
      </div>
    </div>
  );
}

export default async function AuthShell({
  title,
  description,
  children
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const t = await getTranslations('auth.shell');
  return (
    <div className='relative flex min-h-screen flex-col items-center justify-center overflow-hidden md:grid lg:max-w-none lg:grid-cols-2 lg:px-0'>
      <Billboard t={t} />
      <div className='flex h-full items-center justify-center p-4 lg:p-8'>
        <div className='flex w-full max-w-sm flex-col justify-center space-y-6'>
          <div className='space-y-2 text-center'>
            <BrandMark className='mx-auto mb-2 size-12' />
            <h1 className='text-2xl font-semibold tracking-tight'>{title}</h1>
            <p className='text-muted-foreground text-sm'>{description}</p>
          </div>
          {children}
          <LocaleSwitcher className='pt-2' />
          <LegalLinks />
        </div>
      </div>
    </div>
  );
}

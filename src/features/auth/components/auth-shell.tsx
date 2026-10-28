import { getTranslations } from 'next-intl/server';
import { Icons } from '@/components/icons';
import { BrandMark } from '@/components/brand-mark';
import { LocaleSwitcher } from '@/components/i18n/locale-switcher';
import { LegalLinks } from '@/components/legal-links';

const SITE_URL = 'https://levelup-ecosystem.com';

const accent = (chunks: React.ReactNode) => (
  <span className='bg-linear-to-r from-(--bb-violet-soft) to-white bg-clip-text text-transparent'>
    {chunks}
  </span>
);

type ShellT = Awaited<ReturnType<typeof getTranslations<'auth.shell'>>>;

/**
 * Left panel, desktop only (hidden below lg): a calm LevelUp brand panel. Deep
 * violet in every theme, a slow aurora behind a frosted-glass card listing what
 * keeps the account safe. Pure server-rendered markup and CSS (no client JS), so
 * nothing competes with the sign-in form.
 */
function Billboard({ t }: { t: ShellT }) {
  const points = [
    { icon: Icons.shieldCheck, label: t('point1') },
    { icon: Icons.lock, label: t('point2') },
    { icon: Icons.teams, label: t('point3') }
  ];
  return (
    <div className='auth-billboard bb-surface relative hidden flex-col overflow-hidden p-10 text-white lg:sticky lg:top-0 lg:flex lg:h-dvh xl:p-12'>
      <div className='bb-aurora' aria-hidden>
        <i
          className='bb-blob -top-[20%] -right-[15%] size-[75%]'
          style={{
            background:
              'radial-gradient(closest-side, color-mix(in oklab, var(--bb-violet) 85%, transparent), transparent)'
          }}
        />
        <i
          className='bb-blob -bottom-[25%] -left-[20%] size-[80%]'
          style={{
            animationDelay: '-9s',
            animationDirection: 'alternate-reverse',
            background:
              'radial-gradient(closest-side, color-mix(in oklab, oklch(0.62 0.2 265) 70%, transparent), transparent)'
          }}
        />
      </div>
      <div className='bb-noise' aria-hidden />

      <div className='relative z-10 flex items-center justify-between'>
        <div className='flex items-center text-lg font-semibold tracking-tight'>
          <BrandMark className='mr-2.5 size-8' />
          LevelUp
        </div>
        <span className='bb-glass flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium text-white/85'>
          <Icons.lock className='size-3.5' aria-hidden />
          {t('secureBadge')}
        </span>
      </div>

      <div className='relative z-10 my-auto max-w-lg space-y-8 py-10'>
        <div className='space-y-5'>
          <p className='flex items-center gap-2 text-[11px] font-medium tracking-[0.16em] text-white/60 uppercase'>
            <i className='size-1.5 rounded-full bg-(--bb-violet-soft)' aria-hidden />
            {t('eyebrow')}
          </p>
          <h2 className='text-[clamp(1.9rem,3vw,2.9rem)] leading-[1.08] font-semibold tracking-tight text-balance'>
            {t.rich('title', { accent })}
          </h2>
          <p className='max-w-[42ch] text-[15px] leading-relaxed text-white/70'>{t('subtitle')}</p>
        </div>

        <ul className='bb-glass divide-y divide-white/10 rounded-2xl'>
          {points.map(({ icon: Icon, label }) => (
            <li key={label} className='flex items-center gap-3.5 px-5 py-4 text-sm text-white/90'>
              <span className='grid size-9 shrink-0 place-items-center rounded-xl bg-white/10 ring-1 ring-white/15'>
                <Icon className='size-[18px]' aria-hidden />
              </span>
              {label}
            </li>
          ))}
        </ul>
      </div>

      <div className='relative z-10 flex items-center justify-between text-xs text-white/50'>
        <span>{t('rights')}</span>
        <a href={SITE_URL} className='transition-colors hover:text-white'>
          levelup-ecosystem.com
        </a>
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
      <div className='relative flex h-full w-full items-center justify-center p-4 py-10 lg:p-8'>
        <div className='relative flex w-full max-w-sm flex-col justify-center space-y-7'>
          <div className='space-y-2 text-center'>
            <BrandMark className='mx-auto mb-3 size-12' />
            <h1 className='text-[1.75rem] font-semibold tracking-tight'>{title}</h1>
            <p className='text-muted-foreground text-sm'>{description}</p>
          </div>
          {children}
          <p className='text-muted-foreground flex items-center justify-center gap-1.5 text-xs lg:hidden'>
            <Icons.lock className='size-3.5' aria-hidden />
            {t('secureBadge')}
          </p>
          <LocaleSwitcher className='pt-1' />
          <LegalLinks />
        </div>
      </div>
    </div>
  );
}

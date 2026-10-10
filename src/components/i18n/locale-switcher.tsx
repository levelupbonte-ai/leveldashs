'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Icons } from '@/components/icons';
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu';
import { setLocale } from '@/i18n/actions';
import { locales, localeNames, type Locale } from '@/i18n/config';
import { cn } from '@/lib/utils';

function useChangeLocale() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const change = (locale: Locale) =>
    startTransition(async () => {
      await setLocale(locale);
      router.refresh();
    });
  return { pending, change };
}

/** EN · FR links, for the footer of the auth card. */
export function LocaleSwitcher({ className }: { className?: string }) {
  const current = useLocale();
  const t = useTranslations('common.language');
  const { pending, change } = useChangeLocale();

  return (
    <nav
      aria-label={t('label')}
      className={cn(
        'text-muted-foreground flex items-center justify-center gap-1 text-xs',
        className
      )}
    >
      <Icons.language className='size-3.5' aria-hidden />
      {locales.map((locale, i) => (
        <span key={locale} className='flex items-center gap-1'>
          {i > 0 && <span aria-hidden>·</span>}
          <button
            type='button'
            lang={locale}
            disabled={pending || locale === current}
            aria-current={locale === current ? 'true' : undefined}
            onClick={() => change(locale)}
            title={localeNames[locale]}
            className={cn(
              'rounded px-1 py-0.5 uppercase underline-offset-4 transition-colors',
              locale === current
                ? 'text-foreground font-medium'
                : 'hover:text-foreground hover:underline'
            )}
          >
            {locale}
          </button>
        </span>
      ))}
    </nav>
  );
}

/** "Language" submenu for the user menu (dropdown). */
export function LocaleMenuSub() {
  const current = useLocale();
  const t = useTranslations('common.language');
  const { pending, change } = useChangeLocale();

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Icons.language className='mr-2 h-4 w-4' aria-hidden />
        {t('label')}
        <span className='text-muted-foreground ml-auto pl-2 text-xs uppercase'>{current}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup
          value={current}
          onValueChange={(value) => {
            if (!pending && value !== current) change(value as Locale);
          }}
        >
          {locales.map((locale) => (
            <DropdownMenuRadioItem key={locale} value={locale} lang={locale}>
              {localeNames[locale]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

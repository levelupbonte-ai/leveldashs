import { useTranslations } from 'next-intl';
import { LEGAL_LINKS, type LegalDocument } from '@/lib/legal';
import { cn } from '@/lib/utils';

const ORDER: LegalDocument[] = [
  'terms',
  'privacy',
  'acceptableUse',
  'servicesAgreement',
  'dpa',
  'cookies',
  'levelstudioTerms'
];

/** Footer row of links to the LevelUp legal pages (auth card, error pages). */
export function LegalLinks({ className }: { className?: string }) {
  const t = useTranslations('legal');
  return (
    <nav
      aria-label={t('label')}
      className={cn(
        'text-muted-foreground flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs',
        className
      )}
    >
      {ORDER.map((doc) => (
        <a
          key={doc}
          href={LEGAL_LINKS[doc]}
          target='_blank'
          rel='noopener noreferrer'
          className='hover:text-foreground underline-offset-4 hover:underline'
        >
          {t(doc)}
        </a>
      ))}
    </nav>
  );
}

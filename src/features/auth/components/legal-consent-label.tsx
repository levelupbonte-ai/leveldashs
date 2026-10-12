'use client';
import { useTranslations } from 'next-intl';
import { LEGAL_LINKS } from '@/lib/legal';

const link = (href: string) =>
  function LegalLink(chunks: React.ReactNode) {
    return (
      <a
        href={href}
        target='_blank'
        rel='noopener noreferrer'
        className='text-foreground underline underline-offset-4'
        onClick={(e) => e.stopPropagation()}
      >
        {chunks}
      </a>
    );
  };

const TAGS = {
  terms: link(LEGAL_LINKS.terms),
  aup: link(LEGAL_LINKS.acceptableUse),
  privacy: link(LEGAL_LINKS.privacy)
};

/** "I agree to the Terms of Service, Acceptable Use Policy and Privacy Policy" with links. */
export function LegalConsentLabel() {
  const t = useTranslations('legal');
  // One inline box: FieldLabel is a flex container and would split the links apart.
  return <span className='block leading-relaxed'>{t.rich('accept', TAGS)}</span>;
}

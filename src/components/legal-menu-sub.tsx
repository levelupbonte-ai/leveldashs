'use client';
import { useTranslations } from 'next-intl';
import { Icons } from '@/components/icons';
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu';
import { LEGAL_LINKS, type LegalDocument } from '@/lib/legal';

const DOCS: LegalDocument[] = [
  'terms',
  'privacy',
  'acceptableUse',
  'servicesAgreement',
  'dpa',
  'cookies',
  'levelstudioTerms'
];

/** "Legal" submenu of the user menu: the LevelUp legal pages, in a new tab. */
export function LegalMenuSub() {
  const t = useTranslations('legal');
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Icons.post className='mr-2 h-4 w-4' aria-hidden />
        {t('label')}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {DOCS.map((doc) => (
          <DropdownMenuItem
            key={doc}
            onClick={() => window.open(LEGAL_LINKS[doc], '_blank', 'noopener,noreferrer')}
          >
            {t(doc)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

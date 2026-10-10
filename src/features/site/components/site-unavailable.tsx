import { useTranslations } from 'next-intl';
import { Icons } from '@/components/icons';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';

export function SiteUnavailable({ reason }: { reason: 'no-website' | 'disabled' }) {
  const t = useTranslations('site.unavailable');
  return (
    <Empty className='border'>
      <EmptyHeader>
        <EmptyMedia variant='icon'>
          {reason === 'no-website' ? <Icons.world /> : <Icons.lock />}
        </EmptyMedia>
        <EmptyTitle>
          {reason === 'no-website' ? t('noWebsiteTitle') : t('disabledTitle')}
        </EmptyTitle>
        <EmptyDescription>
          {reason === 'no-website' ? t('noWebsite') : t('disabled')}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

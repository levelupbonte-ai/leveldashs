import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { BackButton } from '@/components/errors/back-button';
import { ErrorScreen, LEVELUP_SITE, SUPPORT_EMAIL } from '@/components/errors/error-screen';
import { buttonVariants } from '@/components/ui/button';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('notFound');
  return { title: t('title'), robots: { index: false, follow: false } };
}

export default async function NotFound() {
  const t = await getTranslations('notFound');
  const link = 'hover:text-foreground underline-offset-4 hover:underline';
  return (
    <ErrorScreen
      code='404'
      eyebrow={t('eyebrow')}
      title={t('title')}
      description={t('description')}
      actions={
        <>
          <Link href='/' className={buttonVariants({ size: 'lg' })}>
            {t('home')}
          </Link>
          <BackButton label={t('back')} />
        </>
      }
      footer={
        <>
          <a href={LEVELUP_SITE} className={link}>
            {t('site')}
          </a>
          <a href={`mailto:${SUPPORT_EMAIL}`} className={link}>
            {t('contact')}
          </a>
        </>
      }
    />
  );
}

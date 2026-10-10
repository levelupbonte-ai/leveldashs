import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import PageContainer from '@/components/layout/page-container';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getBillingInfoContent } from '@/config/infoconfig';
import { requireDashboardSession } from '@/lib/auth/session';

const CONTACT_EMAIL = 'contact@levelup-ecosystem.com';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('billing');
  return { title: t('title') };
}

export default async function BillingPage() {
  const { activeOrg } = await requireDashboardSession();
  const t = await getTranslations('billing');
  return (
    <PageContainer
      infoContent={await getBillingInfoContent()}
      pageTitle={t('title')}
      pageDescription={activeOrg ? t('descriptionOrg', { name: activeOrg.name }) : t('description')}
    >
      <Card className='max-w-2xl'>
        <CardHeader>
          <CardTitle>{t('cardTitle')}</CardTitle>
          <CardDescription>{t('cardDescription')}</CardDescription>
        </CardHeader>
        <CardContent className='text-muted-foreground space-y-2 text-sm'>
          <p>
            {t.rich('contact', {
              email: () => (
                <a className='text-primary underline' href={`mailto:${CONTACT_EMAIL}`}>
                  {CONTACT_EMAIL}
                </a>
              )
            })}
          </p>
        </CardContent>
      </Card>
    </PageContainer>
  );
}

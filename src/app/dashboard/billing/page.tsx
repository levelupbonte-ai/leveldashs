import PageContainer from '@/components/layout/page-container';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { billingInfoContent } from '@/config/infoconfig';
import { requireDashboardSession } from '@/lib/auth/session';

export const metadata = { title: 'Facturation' };

export default async function BillingPage() {
  const { activeOrg } = await requireDashboardSession();
  return (
    <PageContainer
      infoContent={billingInfoContent}
      pageTitle='Facturation'
      pageDescription={activeOrg ? `Abonnement de ${activeOrg.name}` : 'Abonnement'}
    >
      <Card className='max-w-2xl'>
        <CardHeader>
          <CardTitle>Votre abonnement LevelUp</CardTitle>
          <CardDescription>
            La facturation est gérée directement par l’équipe LevelUp.
          </CardDescription>
        </CardHeader>
        <CardContent className='text-muted-foreground space-y-2 text-sm'>
          <p>
            Pour changer de formule, ajouter une fonction à votre site ou recevoir une facture,
            écrivez-nous à{' '}
            <a className='text-primary underline' href='mailto:contact@levelup-ecosystem.com'>
              contact@levelup-ecosystem.com
            </a>
            .
          </p>
        </CardContent>
      </Card>
    </PageContainer>
  );
}

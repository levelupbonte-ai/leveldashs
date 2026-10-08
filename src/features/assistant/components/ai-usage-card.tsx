import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDashboardSession } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

type Row = { app: string; provider: string; model: string; calls: number };

const APP_LABELS: Record<string, string> = {
  studio: 'LevelStudio',
  dashboard: 'Dashboard',
  site: 'Site vitrine'
};

/** LevelUp staff only: which AI answered over the last 30 days (paid DeepSeek first). */
export async function AiUsageCard() {
  const session = await getDashboardSession();
  if (!session?.isPlatformAdmin) return null;
  const db = await createClient();
  const { data, error } = await db.rpc('ai_usage_summary', { p_days: 30 });
  if (error) return null;
  const rows = ((data ?? []) as Row[]).sort(
    (a, b) =>
      Number(b.provider === 'deepseek') - Number(a.provider === 'deepseek') || b.calls - a.calls
  );
  const total = rows.reduce((n, r) => n + r.calls, 0);

  return (
    <Card className='mt-6'>
      <CardHeader>
        <CardTitle className='text-base'>Utilisation des IA (30 jours)</CardTitle>
        <CardDescription>
          Visible par l’équipe LevelUp uniquement. {total} appels. DeepSeek est le seul fournisseur
          payant.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className='text-muted-foreground text-sm'>Aucun appel enregistré pour le moment.</p>
        ) : (
          <table className='w-full text-sm'>
            <thead className='text-muted-foreground text-left text-xs'>
              <tr>
                <th className='py-1 font-medium'>Application</th>
                <th className='py-1 font-medium'>Fournisseur</th>
                <th className='py-1 font-medium'>Modèle</th>
                <th className='py-1 text-right font-medium'>Appels</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.app}-${r.provider}-${r.model}`} className='border-t'>
                  <td className='py-1.5'>{APP_LABELS[r.app] ?? r.app}</td>
                  <td className='py-1.5 capitalize'>{r.provider}</td>
                  <td className='text-muted-foreground py-1.5'>{r.model}</td>
                  <td className='py-1.5 text-right tabular-nums'>{r.calls}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

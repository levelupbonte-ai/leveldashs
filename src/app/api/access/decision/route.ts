import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { sendNotice } from '@/lib/email/notice';
import { createClient } from '@/lib/supabase/server';

// LevelUp staff approve or reject an access request. The database checks the
// caller (platform admin, 2FA session); the applicant is told by e-mail.

const Body = z.object({
  userId: z.string().uuid(),
  approve: z.boolean(),
  organizationId: z.string().uuid().optional()
});

const DASHBOARD = 'https://dashboard.levelup-ecosystem.com';

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  let sameHost = false;
  try {
    sameHost = !!origin && new URL(origin).host === request.headers.get('host');
  } catch {
    sameHost = false;
  }
  if (!sameHost) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const db = await createClient();
  const { data, error } = await db.rpc('review_access_request', {
    p_user_id: parsed.data.userId,
    p_approve: parsed.data.approve,
    p_organization_id: parsed.data.organizationId ?? null
  });
  if (error) {
    const mfa = error.message.includes('aal2');
    return NextResponse.json(
      { error: mfa ? 'mfa' : error.code === 'PT403' ? 'forbidden' : 'failed' },
      { status: mfa || error.code === 'PT403' ? 403 : 400 }
    );
  }
  const result = data as { status: string; email?: string };
  if (result.email) {
    await sendNotice(
      parsed.data.approve
        ? {
            to: result.email,
            subject: 'Votre accès au tableau de bord LevelUp est validé',
            title: 'Bienvenue sur votre tableau de bord',
            lines: [
              'Votre demande a été validée par l’équipe LevelUp.',
              'Vous pouvez maintenant vous connecter pour gérer votre site, vos rendez-vous et vos demandes.'
            ],
            cta: { label: 'Ouvrir mon tableau de bord', url: `${DASHBOARD}/dashboard/site` }
          }
        : {
            to: result.email,
            subject: 'Votre demande d’accès LevelUp',
            title: 'Votre demande n’a pas été retenue',
            lines: [
              'Nous ne pouvons pas ouvrir d’accès au tableau de bord pour cette demande pour le moment.',
              'Si vous pensez qu’il s’agit d’une erreur ou si vous souhaitez un site avec LevelUp, répondez simplement à contact@levelup-ecosystem.com.'
            ]
          }
    );
  }
  return NextResponse.json(result);
}

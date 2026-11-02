import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LocaleSwitcher } from '@/components/i18n/locale-switcher';
import { createAnonClient } from '@/lib/supabase/anon';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('unsubscribe');
  return {
    title: t('metaTitle'),
    robots: { index: false, follow: false },
    referrer: 'no-referrer'
  };
}

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Info =
  | { status: 'subscribed' | 'unsubscribed'; site_name: string; email: string }
  | { status: 'invalid' }
  | { status: 'test' };

async function loadInfo(token: string): Promise<Info> {
  if (token === 'test') return { status: 'test' };
  if (!TOKEN.test(token)) return { status: 'invalid' };
  const { data, error } = await createAnonClient().rpc('email_unsubscribe_info', {
    p_token: token
  });
  if (error || !data) return { status: 'invalid' };
  return data as Info;
}

// Public page behind the unsubscribe link of every campaign e-mail. Opening it
// changes nothing (link scanners open links); the button posts to the one-click
// endpoint, which unsubscribes this contact only.
export default async function UnsubscribePage(props: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ c?: string; done?: string }>;
}) {
  const { token } = await props.params;
  const { c, done } = await props.searchParams;
  const t = await getTranslations('unsubscribe');
  const info = await loadInfo(token);
  const campaign = c && UUID.test(c) ? c : null;
  const action = `/api/email/unsubscribe/${encodeURIComponent(token)}${campaign ? `?c=${campaign}` : ''}`;

  let title: string;
  let description: string;
  let body: React.ReactNode = null;
  let icon = <Icons.mail className='size-6' aria-hidden />;
  if (info.status === 'test') {
    title = t('testTitle');
    description = t('testDescription');
  } else if (info.status === 'invalid') {
    title = t('invalidTitle');
    description = t('invalidDescription');
    icon = <Icons.alertCircle className='size-6' aria-hidden />;
  } else if (info.status === 'unsubscribed' || (info.status === 'subscribed' && done)) {
    title = t('doneTitle');
    description = t('doneDescription', { site: info.site_name });
    icon = <Icons.mailCheck className='size-6' aria-hidden />;
  } else {
    title = t('title');
    description = t('description', { site: info.site_name, email: info.email });
    body = (
      <form method='post' action={action}>
        <input type='hidden' name='from' value='page' />
        <Button type='submit' className='w-full'>
          {t('confirm')}
        </Button>
      </form>
    );
  }

  return (
    <main className='bg-muted/40 flex min-h-svh items-center justify-center px-4 py-10'>
      <div className='w-full max-w-md space-y-4'>
        <Card>
          <CardHeader className='items-center text-center'>
            <div className='bg-muted text-foreground mx-auto mb-2 flex size-12 items-center justify-center rounded-full'>
              {icon}
            </div>
            <CardTitle className='text-xl'>{title}</CardTitle>
            <CardDescription className='text-balance'>{description}</CardDescription>
          </CardHeader>
          {body && <CardContent>{body}</CardContent>}
        </Card>
        <p className='text-muted-foreground text-center text-xs'>{t('footer')}</p>
        <div className='flex justify-center'>
          <LocaleSwitcher />
        </div>
      </div>
    </main>
  );
}

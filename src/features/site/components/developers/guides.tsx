'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/lib/supabase/env';
import { cn } from '@/lib/utils';
import type { WebsiteIntegration } from '../../api/types';
import { CodeBlock, CopyField } from './code-block';
import {
  CONTENT_SNIPPET,
  CURL_SNIPPET,
  envSnippet,
  EVENT_SNIPPET,
  FORM_SNIPPET,
  JS_API_SNIPPET,
  nextScriptSnippet,
  tagOptionsSnippet,
  tagSnippet,
  WEBHOOK_SNIPPET
} from './snippets';

const code = (chunks: React.ReactNode) => (
  <code className='bg-muted rounded px-1 py-0.5 font-mono text-[0.85em]'>{chunks}</code>
);

/** The exact payments endpoint of the LevelUp API (public: the client is signed in). */
export const PAYMENTS_ENDPOINT = `${SUPABASE_URL}/rest/v1/rpc/site_ingest_payment`;

function Step({
  n,
  title,
  done,
  children,
  last
}: {
  n: number;
  title: string;
  done?: boolean;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <li className='relative flex gap-4'>
      <div className='flex flex-col items-center'>
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold tabular-nums',
            done
              ? 'border-emerald-600/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'bg-background'
          )}
          aria-hidden
        >
          {done ? <Icons.check className='size-4' /> : n}
        </span>
        {!last && <span className='bg-border mt-2 w-px flex-1' aria-hidden />}
      </div>
      <div className={cn('min-w-0 flex-1 space-y-3', !last && 'pb-8')}>
        <h3 className='pt-1 font-medium'>{title}</h3>
        {children}
      </div>
    </li>
  );
}

export function QuickStart({ site, installed }: { site: WebsiteIntegration; installed: boolean }) {
  const t = useTranslations('site.developers.quickstart');
  return (
    <div className='grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]'>
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ol>
            <Step n={1} title={t('step1Title')}>
              <p className='text-muted-foreground text-sm'>
                {t.rich('step1Body', { code: () => code('</body>') })}
              </p>
              <CodeBlock code={tagSnippet(site.id)} label='HTML' />
            </Step>
            <Step n={2} title={t('step2Title')}>
              <p className='text-muted-foreground text-sm'>{t('step2Body')}</p>
              {site.allowed_origins.length > 0 && (
                <ul className='flex flex-wrap gap-1.5'>
                  {site.allowed_origins.map((o) => (
                    <li key={o}>
                      <a
                        href={o}
                        target='_blank'
                        rel='noreferrer'
                        className='hover:bg-muted inline-flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-xs'
                      >
                        {o.replace(/^https?:\/\//, '')}
                        <Icons.externalLink className='size-3' aria-hidden />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </Step>
            <Step n={3} title={t('step3Title')} done={installed} last>
              <p className='text-muted-foreground text-sm'>
                {installed ? t('step3Done') : t('step3Body')}
              </p>
            </Step>
          </ol>
        </CardContent>
      </Card>

      <div className='space-y-6'>
        <Card>
          <CardHeader>
            <CardTitle className='text-sm'>{t('frameworkTitle')}</CardTitle>
            <CardDescription>{t('frameworkBody')}</CardDescription>
          </CardHeader>
          <CardContent>
            <CodeBlock code={nextScriptSnippet(site.id)} label='Next.js' />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className='text-sm'>{t('optionsTitle')}</CardTitle>
          </CardHeader>
          <CardContent className='space-y-3'>
            <ul className='text-muted-foreground space-y-2 text-sm'>
              <li>{t.rich('optSeo', { code })}</li>
              <li>{t.rich('optForms', { code })}</li>
              <li>{t.rich('optAnalytics', { code })}</li>
            </ul>
            <CodeBlock code={tagOptionsSnippet(site.id)} label='HTML' />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

const ERROR_CODES = ['PT403', 'PT404', 'PT409', 'PT429', '22023'] as const;

export function JavaScriptGuide() {
  const t = useTranslations('site.developers.javascript');
  return (
    <div className='grid grid-cols-1 gap-6 lg:grid-cols-2'>
      <Card>
        <CardHeader>
          <CardTitle>{t('formsTitle')}</CardTitle>
          <CardDescription>{t.rich('formsBody', { code })}</CardDescription>
        </CardHeader>
        <CardContent className='space-y-3'>
          <CodeBlock code={FORM_SNIPPET} label='HTML' />
          <p className='text-muted-foreground text-xs'>{t.rich('formsFields', { code })}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('contentTitle')}</CardTitle>
          <CardDescription>{t.rich('contentBody', { code })}</CardDescription>
        </CardHeader>
        <CardContent>
          <CodeBlock code={CONTENT_SNIPPET} label='HTML' />
        </CardContent>
      </Card>
      <Card className='lg:col-span-2'>
        <CardHeader>
          <CardTitle>{t('apiTitle')}</CardTitle>
          <CardDescription>{t.rich('apiBody', { code })}</CardDescription>
        </CardHeader>
        <CardContent className='grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_280px]'>
          <CodeBlock code={JS_API_SNIPPET} label='JavaScript' />
          <div>
            <h3 className='mb-2 text-sm font-medium'>{t('errorsTitle')}</h3>
            <ul className='divide-y rounded-lg border text-sm'>
              {ERROR_CODES.map((c) => (
                <li key={c} className='flex items-start gap-3 px-3 py-2'>
                  <code className='w-12 shrink-0 font-mono text-xs font-semibold'>{c}</code>
                  <span className='text-muted-foreground text-xs'>{t(`errors.${c}`)}</span>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const SUMMARY = [
  'provider_event_id',
  'provider_session_id',
  'status',
  'amount',
  'currency',
  'occurred_at'
] as const;
const CONTRACT = [
  ['provider', true],
  ['provider_event_id', true],
  ['provider_session_id', true],
  ['provider_payment_intent', false],
  ['status', true],
  ['amount', true],
  ['currency', true],
  ['offer_id', false],
  ['offer_name', false],
  ['customer_email', false],
  ['customer_name', false],
  ['occurred_at', true],
  ['metadata', false]
] as const;
const RESPONSES = [
  ['200', 'recorded'],
  ['200', 'duplicate'],
  ['400', '22023'],
  ['401', 'PT401'],
  ['403', 'PT403'],
  ['429', 'PT429']
] as const;

export function PaymentsGuide() {
  const t = useTranslations('site.developers.payments');
  const [full, setFull] = useState(false);
  return (
    <div className='space-y-6'>
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent className='grid grid-cols-1 gap-6 lg:grid-cols-2'>
          <div className='space-y-4'>
            <div className='space-y-1.5'>
              <p className='flex items-center gap-2 text-sm font-medium'>
                {t('endpoint')}
                <Badge variant='secondary' className='font-mono text-[10px]'>
                  POST
                </Badge>
              </p>
              <CopyField value={PAYMENTS_ENDPOINT} />
            </div>
            <div className='space-y-1.5'>
              <p className='text-sm font-medium'>{t('publicKey')}</p>
              <CopyField value={SUPABASE_PUBLISHABLE_KEY} />
              <p className='text-muted-foreground text-xs'>{t.rich('publicKeyHint', { code })}</p>
            </div>
            <div className='space-y-1.5'>
              <p className='text-sm font-medium'>{t('serverKey')}</p>
              <p className='text-muted-foreground text-xs'>{t.rich('serverKeyHint', { code })}</p>
            </div>
          </div>
          <div className='space-y-1.5'>
            <p className='text-sm font-medium'>{t('envTitle')}</p>
            <CodeBlock
              code={envSnippet(PAYMENTS_ENDPOINT, SUPABASE_PUBLISHABLE_KEY)}
              label='.env'
            />
            <p className='text-muted-foreground text-xs'>{t('envHint')}</p>
          </div>
        </CardContent>
      </Card>

      <div className='grid grid-cols-1 gap-6 xl:grid-cols-2'>
        <Card>
          <CardHeader>
            <CardTitle>{t('contractTitle')}</CardTitle>
            <CardDescription>{t.rich('contractDescription', { code })}</CardDescription>
          </CardHeader>
          <CardContent className='space-y-4'>
            <ul className='space-y-2.5 text-sm'>
              {SUMMARY.map((f) => (
                <li key={f} className='flex flex-col gap-0.5 sm:flex-row sm:gap-3'>
                  <code className='w-48 shrink-0 font-mono text-xs font-semibold'>{f}</code>
                  <span className='text-muted-foreground text-xs'>{t(`fields.${f}`)}</span>
                </li>
              ))}
            </ul>
            <CodeBlock code={EVENT_SNIPPET} label='p_event (JSON)' />
            <Collapsible open={full} onOpenChange={setFull}>
              <CollapsibleTrigger
                render={<Button variant='outline' size='sm' className='w-full sm:w-auto' />}
              >
                <Icons.listDetails className='size-4' aria-hidden />
                {full ? t('hideContract') : t('showContract', { count: CONTRACT.length })}
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div id='full-contract' className='mt-3 overflow-x-auto rounded-lg border'>
                  <table className='w-full text-left text-xs'>
                    <thead className='bg-muted/60'>
                      <tr>
                        <th className='px-3 py-2 font-medium'>{t('field')}</th>
                        <th className='px-3 py-2 font-medium'>{t('rule')}</th>
                      </tr>
                    </thead>
                    <tbody className='divide-y'>
                      {CONTRACT.map(([f, required]) => (
                        <tr key={f}>
                          <td className='px-3 py-2 align-top whitespace-nowrap'>
                            <code className='font-mono font-semibold'>{f}</code>
                            {required && (
                              <span className='text-muted-foreground ml-1.5'>{t('required')}</span>
                            )}
                          </td>
                          <td className='text-muted-foreground px-3 py-2'>{t(`fields.${f}`)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className='text-muted-foreground mt-3 text-xs'>{t('strict')}</p>
              </CollapsibleContent>
            </Collapsible>
          </CardContent>
        </Card>

        <div className='space-y-6'>
          <Card>
            <CardHeader>
              <CardTitle>{t('responsesTitle')}</CardTitle>
            </CardHeader>
            <CardContent className='space-y-4'>
              <ul className='divide-y rounded-lg border text-sm'>
                {RESPONSES.map(([http, key]) => (
                  <li key={key} className='flex items-start gap-3 px-3 py-2'>
                    <Badge
                      variant={http === '200' ? 'secondary' : 'outline'}
                      className='w-11 shrink-0 justify-center font-mono text-[10px]'
                    >
                      {http}
                    </Badge>
                    <span className='text-muted-foreground text-xs'>{t(`responses.${key}`)}</span>
                  </li>
                ))}
              </ul>
              <p className='text-muted-foreground text-xs'>{t('statusRule')}</p>
              <p className='text-muted-foreground text-xs'>{t.rich('testMode', { code })}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className='text-sm'>{t('curlTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              <CodeBlock code={CURL_SNIPPET(PAYMENTS_ENDPOINT)} label='Shell' />
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('exampleTitle')}</CardTitle>
          <CardDescription>{t('exampleDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <CodeBlock code={WEBHOOK_SNIPPET} label='app/api/stripe/webhook/route.ts' />
        </CardContent>
      </Card>
    </div>
  );
}

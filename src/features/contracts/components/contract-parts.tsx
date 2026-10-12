'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { Icons } from '@/components/icons';
import { Markdown } from '@/components/markdown';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type { Contract, ContractSignature, OrderForm } from '../api/types';
import { SIGNATURE_HEIGHT, SIGNATURE_WIDTH } from './signature-pad';

export type ContractStep = 'review' | 'sign' | 'done';

/** Review → Sign → Done. */
export function ContractSteps({ step }: { step: ContractStep }) {
  const t = useTranslations('contract.steps');
  const steps: ContractStep[] = ['review', 'sign', 'done'];
  const current = steps.indexOf(step);
  return (
    <ol className='flex items-center gap-2 sm:gap-3' aria-label={t('label')}>
      {steps.map((s, i) => {
        const done = i < current || step === 'done';
        const active = i === current && step !== 'done';
        return (
          <li key={s} className='flex min-w-0 flex-1 items-center gap-2 sm:gap-3'>
            <span
              aria-current={active ? 'step' : undefined}
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors',
                done && 'bg-primary border-primary text-primary-foreground',
                active && 'border-primary text-primary ring-primary/15 ring-4',
                !done && !active && 'text-muted-foreground'
              )}
            >
              {done ? <Icons.check className='size-4' aria-hidden /> : i + 1}
            </span>
            <span
              className={cn(
                'truncate text-sm',
                active || done ? 'text-foreground font-medium' : 'text-muted-foreground'
              )}
            >
              {t(s)}
            </span>
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className={cn('h-px min-w-3 flex-1', done ? 'bg-primary' : 'bg-border')}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function DocumentBody({ source }: { source: string }) {
  return (
    <div className='max-h-[34rem] overflow-y-auto overscroll-contain px-5 py-5 sm:px-8 sm:py-7'>
      <Markdown source={source} />
    </div>
  );
}

/** The frozen agreement text: official English, French translation for information. */
export function ContractDocument({ contract }: { contract: Contract }) {
  const t = useTranslations('contract.document');
  const hasTranslation = !!contract.translatedBody;
  return (
    <Card className='gap-0 overflow-hidden py-0'>
      <CardHeader className='border-b px-5 py-4 sm:px-8'>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <div className='min-w-0 space-y-1'>
            <CardTitle className='text-base'>{contract.title}</CardTitle>
            <CardDescription>{t('version', { version: contract.templateVersion })}</CardDescription>
          </div>
          <Icons.contract className='text-muted-foreground size-5 shrink-0' aria-hidden />
        </div>
      </CardHeader>
      {hasTranslation ? (
        <Tabs defaultValue={contract.locale === 'fr' ? 'fr' : 'en'} className='gap-0'>
          <div className='border-b px-5 py-3 sm:px-8'>
            <TabsList>
              <TabsTrigger value='en'>{t('english')}</TabsTrigger>
              <TabsTrigger value='fr'>{t('french')}</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value='en'>
            <DocumentBody source={contract.body} />
          </TabsContent>
          <TabsContent value='fr'>
            <p className='bg-muted/50 text-muted-foreground border-b px-5 py-2.5 text-xs sm:px-8'>
              {t('translationNotice')}
            </p>
            <DocumentBody source={contract.translatedBody ?? ''} />
          </TabsContent>
        </Tabs>
      ) : (
        <DocumentBody source={contract.body} />
      )}
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className='flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4'>
      <dt className='text-muted-foreground text-sm'>{label}</dt>
      <dd className='text-sm font-medium sm:text-end'>{children}</dd>
    </div>
  );
}

/** Order form summary (filled by LevelUp). */
export function OrderFormCard({ form }: { form: OrderForm }) {
  const t = useTranslations('contract.orderForm');
  const format = useFormatter();
  const money = (value: number) => format.number(value, { style: 'currency', currency: 'USD' });
  const hasAny = Object.keys(form).some((k) => k !== 'client');
  return (
    <Card className='gap-4'>
      <CardHeader>
        <CardTitle className='text-base'>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {!hasAny ? (
          <p className='text-muted-foreground text-sm'>{t('empty')}</p>
        ) : (
          <dl className='divide-y'>
            {form.client && <Row label={t('client')}>{form.client}</Row>}
            {form.projectName && <Row label={t('project')}>{form.projectName}</Row>}
            {form.packageName && <Row label={t('package')}>{form.packageName}</Row>}
            {form.buildPrice !== undefined && (
              <Row label={t('buildPrice')}>{money(form.buildPrice)}</Row>
            )}
            {form.paymentSchedule && <Row label={t('paymentSchedule')}>{form.paymentSchedule}</Row>}
            {(form.monthlyPlan || form.monthlyPrice !== undefined) && (
              <Row label={t('monthlyPlan')}>
                {[
                  form.monthlyPlan,
                  form.monthlyPrice !== undefined
                    ? t('perMonth', { amount: money(form.monthlyPrice) })
                    : null
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Row>
            )}
            {form.startDate && (
              <Row label={t('startDate')}>
                {format.dateTime(new Date(`${form.startDate}T12:00:00Z`), {
                  dateStyle: 'long',
                  timeZone: 'UTC'
                })}
              </Row>
            )}
            {form.scope && form.scope.length > 0 && (
              <div className='space-y-2 py-3'>
                <dt className='text-muted-foreground text-sm'>{t('scope')}</dt>
                <dd>
                  <ul className='space-y-1.5'>
                    {form.scope.map((item, i) => (
                      <li key={i} className='flex gap-2 text-sm'>
                        <Icons.check className='text-primary mt-0.5 size-4 shrink-0' aria-hidden />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
            {form.notes && (
              <div className='space-y-1 py-3'>
                <dt className='text-muted-foreground text-sm'>{t('notes')}</dt>
                <dd className='text-sm whitespace-pre-line'>{form.notes}</dd>
              </div>
            )}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

/** Hand-drawn signature, if any (SVG path data; never markup). */
export function SignatureImage({ path, className }: { path: string; className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${SIGNATURE_WIDTH} ${SIGNATURE_HEIGHT}`}
      className={cn('h-16 w-auto', className)}
      aria-hidden
    >
      <path
        d={path}
        fill='none'
        className='stroke-foreground'
        strokeWidth='4'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  );
}

/** Signature certificate: who, when (UTC), from where, which document. */
export function SignatureCertificate({
  contractId,
  signature
}: {
  contractId: string;
  signature: ContractSignature;
}) {
  const t = useTranslations('contract.certificate');
  const format = useFormatter();
  const items: [string, string][] = [
    [t('signer'), `${signature.signerName} · ${signature.signerTitle}`],
    [t('email'), signature.signerEmail],
    [
      t('signedAt'),
      `${format.dateTime(new Date(signature.signedAt), {
        dateStyle: 'medium',
        timeStyle: 'medium',
        timeZone: 'UTC'
      })} UTC`
    ],
    [t('ip'), signature.ip ?? t('unknown')],
    [t('contractId'), contractId],
    [t('hash'), signature.documentHash]
  ];
  return (
    <div className='space-y-3'>
      {signature.drawnSignature && (
        <div className='bg-background w-fit rounded-md border px-3 py-1'>
          <SignatureImage path={signature.drawnSignature} />
        </div>
      )}
      <dl className='grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]'>
        {items.map(([label, value]) => (
          <div key={label} className='contents'>
            <dt className='text-muted-foreground'>{label}</dt>
            <dd className='min-w-0 font-mono text-xs break-all sm:text-sm'>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

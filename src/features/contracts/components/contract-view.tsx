'use client';

import { useSuspenseQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { Suspense, useState } from 'react';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { useDashboardSession } from '@/lib/auth/session-context';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { contractQueryOptions, contractsQueryOptions } from '../api/queries';
import { contractPdfUrl, pickCurrent } from '../api/service';
import type { Contract, ContractSummary, FinalizeResult } from '../api/types';
import {
  ContractDocument,
  ContractSteps,
  OrderFormCard,
  SignatureCertificate,
  type ContractStep
} from './contract-parts';
import { RequiredTasks } from './required-tasks';
import { SignContractForm } from './sign-contract-form';

function DownloadButton({
  id,
  variant = 'default'
}: {
  id: string;
  variant?: 'default' | 'outline';
}) {
  const t = useTranslations('contract');
  return (
    <a
      href={contractPdfUrl(id)}
      download
      className={buttonVariants({ variant, size: 'sm', className: 'w-full sm:w-auto' })}
    >
      <Icons.download className='size-4' aria-hidden />
      {t('downloadPdf')}
    </a>
  );
}

function SignedState({
  contract,
  finalize
}: {
  contract: Contract;
  finalize: FinalizeResult | null;
}) {
  const t = useTranslations('contract.done');
  const format = useFormatter();
  const emailed = finalize ? finalize.emailed : !!contract.emailedAt;
  return (
    <div className='space-y-6'>
      <Card className='border-primary/20 from-primary/5 overflow-hidden bg-gradient-to-b to-transparent'>
        <CardContent className='flex flex-col items-start gap-5 sm:flex-row sm:items-center'>
          <div className='bg-primary text-primary-foreground flex size-12 shrink-0 items-center justify-center rounded-full'>
            <Icons.check className='size-6' aria-hidden />
          </div>
          <div className='min-w-0 flex-1 space-y-1'>
            <h2 className='text-lg font-semibold tracking-tight'>{t('title')}</h2>
            <p className='text-muted-foreground text-sm'>
              {t('description', {
                title: contract.title,
                date: contract.signedAt
                  ? format.dateTime(new Date(contract.signedAt), { dateStyle: 'long' })
                  : ''
              })}
            </p>
            {emailed && (
              <p className='text-muted-foreground flex items-center gap-1.5 text-sm'>
                <Icons.mailCheck className='size-4' aria-hidden />
                {t('emailed')}
              </p>
            )}
          </div>
          <DownloadButton id={contract.id} />
        </CardContent>
      </Card>
      <div className='grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]'>
        {contract.signature && (
          <Card className='gap-4'>
            <CardHeader>
              <CardTitle className='flex items-center gap-2 text-base'>
                <Icons.certificate className='text-primary size-5' aria-hidden />
                {t('certificate')}
              </CardTitle>
              <CardDescription>{t('certificateDescription')}</CardDescription>
            </CardHeader>
            <CardContent>
              <SignatureCertificate contractId={contract.id} signature={contract.signature} />
            </CardContent>
          </Card>
        )}
        <OrderFormCard form={contract.orderForm} />
      </div>
    </div>
  );
}

function WaitingForSigner({ orgName }: { orgName: string }) {
  const t = useTranslations('contract.waiting');
  return (
    <Card className='gap-3'>
      <CardHeader>
        <CardTitle className='flex items-center gap-2 text-base'>
          <Icons.clock className='text-primary size-5' aria-hidden />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description', { organization: orgName })}</CardDescription>
      </CardHeader>
    </Card>
  );
}

function CurrentContract({ id }: { id: string }) {
  const t = useTranslations('contract');
  const session = useDashboardSession();
  const db = createClient();
  const { data: contract } = useSuspenseQuery(contractQueryOptions(db, id));
  const [step, setStep] = useState<ContractStep>('review');
  const [finalize, setFinalize] = useState<FinalizeResult | null>(null);
  if (!contract) return null;

  const signed = contract.status === 'signed';
  const role = session.activeOrg?.role;
  const canSign = role === 'owner' || role === 'admin';

  return (
    <div className='space-y-6'>
      <Card className='gap-4 py-5'>
        <CardContent className='space-y-4 px-5'>
          <ContractSteps step={signed ? 'done' : step} />
          {!signed && (
            <p className='text-muted-foreground text-sm'>
              {contract.required ? t('introRequired') : t('intro')}
            </p>
          )}
        </CardContent>
      </Card>
      {signed ? (
        <SignedState contract={contract} finalize={finalize} />
      ) : (
        <>
          <div className='grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]'>
            <ContractDocument contract={contract} />
            <div className='lg:sticky lg:top-20'>
              <OrderFormCard form={contract.orderForm} />
            </div>
          </div>
          {canSign ? (
            <SignContractForm
              contract={contract}
              defaultName={session.user.fullName}
              onStart={() => setStep('sign')}
              onSigned={(result) => {
                setFinalize(result);
                setStep('done');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            />
          ) : (
            <WaitingForSigner orgName={session.activeOrg?.name ?? ''} />
          )}
        </>
      )}
    </div>
  );
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  sent: 'default',
  signed: 'secondary',
  superseded: 'outline'
};

function ContractHistory({ contracts }: { contracts: ContractSummary[] }) {
  const t = useTranslations('contract.history');
  const ts = useTranslations('contract.status');
  const format = useFormatter();
  if (contracts.length === 0) return null;
  return (
    <Card className='gap-4'>
      <CardHeader>
        <CardTitle className='text-base'>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className='divide-y rounded-lg border'>
          {contracts.map((c) => (
            <li key={c.id} className='flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:gap-4'>
              <div className='flex min-w-0 flex-1 items-start gap-3'>
                <Icons.contract
                  className='text-muted-foreground mt-0.5 size-5 shrink-0'
                  aria-hidden
                />
                <div className='min-w-0'>
                  <p className='flex flex-wrap items-center gap-2 text-sm font-medium'>
                    {c.title}
                    <Badge variant={STATUS_VARIANT[c.status] ?? 'outline'}>{ts(c.status)}</Badge>
                  </p>
                  <p className='text-muted-foreground text-sm'>
                    {t('version', { version: c.templateVersion })}
                    {c.signedAt &&
                      ` · ${t('signedOn', {
                        date: format.dateTime(new Date(c.signedAt), { dateStyle: 'medium' })
                      })}`}
                  </p>
                </div>
              </div>
              {c.status !== 'sent' && (
                <div className={cn('ps-8 sm:ps-0')}>
                  <DownloadButton id={c.id} variant='outline' />
                </div>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function SuspendedNotice() {
  const t = useTranslations('contract.suspended');
  return (
    <Card className='gap-3'>
      <CardHeader>
        <CardTitle className='text-base'>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
    </Card>
  );
}

/** /dashboard/contract: the contract to review and sign, required tasks, history. */
export function ContractView({ organizationId }: { organizationId: string }) {
  const t = useTranslations('contract.empty');
  const { access } = useDashboardSession();
  const db = createClient();
  const { data: contracts } = useSuspenseQuery(contractsQueryOptions(db, organizationId));
  const current = pickCurrent(contracts);
  const others = contracts.filter((c) => c.id !== current?.id);

  return (
    <div className='space-y-6'>
      {access.state === 'suspended' && <SuspendedNotice />}
      <RequiredTasks />
      {current ? (
        <Suspense fallback={<Skeleton className='h-96 w-full' />}>
          <CurrentContract key={current.id} id={current.id} />
        </Suspense>
      ) : (
        access.pendingTasks.length === 0 && (
          <Empty className='border'>
            <EmptyHeader>
              <EmptyMedia variant='icon'>
                <Icons.contract aria-hidden />
              </EmptyMedia>
              <EmptyTitle>{t('title')}</EmptyTitle>
              <EmptyDescription>{t('description')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )
      )}
      <ContractHistory contracts={others} />
    </div>
  );
}

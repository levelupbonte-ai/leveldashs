'use client';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { useDiscountText } from '@/features/billing/components/discount-badge';
import { useErrorMessage } from '@/hooks/use-error-message';
import { createClient } from '@/lib/supabase/client';
import { setDiscountActive } from '../../api/billing';
import { billingOrgsQueryOptions, discountsQueryOptions } from '../../api/queries';
import type { DiscountRow } from '../../api/types';
import { useRefreshBilling } from './charge-dialogs';
import { ConfirmDialog } from './confirm-dialog';
import { DiscountDialog, emptyDiscount, type DiscountDraft } from './discount-dialog';

/** Staff: organization discounts and promo codes. */
export function DiscountsAdmin() {
  const db = createClient();
  const { data } = useSuspenseQuery(discountsQueryOptions(db));
  const { data: orgs } = useSuspenseQuery(billingOrgsQueryOptions(db));
  const t = useTranslations('admin.billing.discount');
  const tSheet = useTranslations('admin.billing.sheet');
  const format = useFormatter();
  const discountText = useDiscountText();
  const errorMessage = useErrorMessage();
  const refresh = useRefreshBilling();
  const [draft, setDraft] = useState<DiscountDraft | null>(null);
  const [ending, setEnding] = useState<DiscountRow | null>(null);
  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      setDiscountActive(createClient(), id, active),
    onSuccess: () => refresh(),
    onError: (e) => toast.error(errorMessage(e, 'saveFailed'))
  });
  const organizations = orgs.map((o) => ({
    id: o.organization_id,
    name: o.organization_name
  }));
  // Fixed for this render cycle (the state badges are a snapshot).
  const [now] = useState(() => Date.now());
  const day = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium' });

  const state = (d: DiscountRow) => {
    if (!d.active) return { label: t('inactive'), variant: 'outline' as const };
    if (d.ends_at && Date.parse(d.ends_at) <= now)
      return { label: t('expired'), variant: 'outline' as const };
    if (d.starts_at && Date.parse(d.starts_at) > now) {
      return {
        label: t('scheduled', { date: day(d.starts_at) }),
        variant: 'secondary' as const
      };
    }
    return { label: tSheet('inEffect'), variant: 'default' as const };
  };

  return (
    <Card>
      <CardContent className='space-y-4 pt-6'>
        <div className='flex justify-end'>
          <Button onClick={() => setDraft(emptyDiscount(null))}>
            <Icons.add className='size-4' aria-hidden />
            {t('new')}
          </Button>
        </div>
        {data.length === 0 ? (
          <p className='text-muted-foreground text-sm'>{t('empty')}</p>
        ) : (
          <div className='overflow-x-auto rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('label')}</TableHead>
                  <TableHead>{t('organization')}</TableHead>
                  <TableHead>{t('appliesTo')}</TableHead>
                  <TableHead>{t('endsAt')}</TableHead>
                  <TableHead>{t('maxUses')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((d) => {
                  const s = state(d);
                  return (
                    <TableRow key={d.id}>
                      <TableCell>
                        <div className='font-medium'>{discountText(d)}</div>
                        <div className='flex flex-wrap items-center gap-2 text-xs'>
                          {d.code ? (
                            <span className='font-mono'>{d.code}</span>
                          ) : (
                            <span className='text-muted-foreground'>{t('orgWide')}</span>
                          )}
                          <Badge variant={s.variant}>{s.label}</Badge>
                        </div>
                      </TableCell>
                      <TableCell>{d.organization_name ?? t('anyOrganization')}</TableCell>
                      <TableCell>{t(`scope.${d.applies_to}`)}</TableCell>
                      <TableCell className='tabular-nums'>
                        {d.ends_at ? day(d.ends_at) : '—'}
                      </TableCell>
                      <TableCell className='tabular-nums'>
                        {d.max_uses === null
                          ? t('usesUnlimited', { uses: d.uses })
                          : t('uses', { uses: d.uses, max: d.max_uses })}
                      </TableCell>
                      <TableCell className='space-x-1 text-right whitespace-nowrap'>
                        <Button
                          size='sm'
                          variant='ghost'
                          onClick={() =>
                            setDraft({
                              ...d,
                              organizationId: d.organization_id,
                              value: d.value
                            })
                          }
                        >
                          {t('edit')}
                        </Button>
                        {d.active ? (
                          <Button size='sm' variant='ghost' onClick={() => setEnding(d)}>
                            {tSheet('deactivate')}
                          </Button>
                        ) : (
                          <Button
                            size='sm'
                            variant='ghost'
                            onClick={() => toggle.mutate({ id: d.id, active: true })}
                          >
                            {tSheet('activate')}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      <DiscountDialog
        draft={draft}
        organizations={organizations}
        onOpenChange={(v) => !v && setDraft(null)}
      />
      <ConfirmDialog
        open={!!ending}
        destructive
        title={tSheet('deactivate')}
        description={tSheet('deactivateConfirm')}
        confirmLabel={tSheet('deactivate')}
        onConfirm={() => ending && toggle.mutate({ id: ending.id, active: false })}
        onOpenChange={(v) => !v && setEnding(null)}
      />
    </Card>
  );
}

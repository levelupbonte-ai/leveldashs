'use client';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { CampaignStatus, ContactStatus } from '../api/types';

const CAMPAIGN_TONE: Record<CampaignStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  scheduled: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  sending: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  sent: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  failed: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200'
};

const CONTACT_TONE: Record<ContactStatus, string> = {
  subscribed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  unsubscribed: 'bg-muted text-muted-foreground',
  bounced: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  complained: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200'
};

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  const t = useTranslations('emailCampaigns.status');
  return (
    <Badge variant='outline' className={cn('border-transparent', CAMPAIGN_TONE[status])}>
      {t(status)}
    </Badge>
  );
}

export function ContactStatusBadge({ status }: { status: ContactStatus }) {
  const t = useTranslations('emailCampaigns.contactStatus');
  return (
    <Badge variant='outline' className={cn('border-transparent', CONTACT_TONE[status])}>
      {t(status)}
    </Badge>
  );
}

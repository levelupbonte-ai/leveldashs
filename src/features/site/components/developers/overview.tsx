'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { LoadingButton } from '@/components/ui/loading-button';
import { Textarea } from '@/components/ui/textarea';
import { useNow } from '@/features/insights/lib/use-now';
import { cleanLine, isWebOrigin } from '@/lib/validation/sanitize';
import { cn } from '@/lib/utils';
import { useSiteMutations } from '../../api/mutations';
import { siteKeys } from '../../api/queries';
import type { WebsiteIntegration } from '../../api/types';
import { useSiteScope } from '../use-site-scope';
import { CopyField } from './code-block';

/** The tag counts as installed when it reported itself in the last 7 days. */
const INSTALLED_WITHIN_MS = 7 * 24 * 3600 * 1000;

export function tagInstalled(site: WebsiteIntegration, now: number) {
  return !!site.tag_last_seen_at && now - Date.parse(site.tag_last_seen_at) < INSTALLED_WITHIN_MS;
}

const ENV_STYLE: Record<string, string> = {
  active:
    'border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/30 dark:text-emerald-300',
  draft:
    'border-amber-600/30 bg-amber-500/10 text-amber-700 dark:border-amber-400/30 dark:text-amber-300',
  suspended: 'border-destructive/30 bg-destructive/10 text-destructive',
  archived: ''
};

function StatusDot({ on }: { on: boolean }) {
  return (
    <span className='relative flex size-2' aria-hidden>
      {on && (
        <span className='absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60 motion-reduce:animate-none' />
      )}
      <span
        className={cn(
          'relative inline-flex size-2 rounded-full',
          on ? 'bg-emerald-500' : 'bg-muted-foreground/40'
        )}
      />
    </span>
  );
}

/** Header of the Developers page: site ID, environment, tag status, allowed domains. */
export function DevelopersOverview({ site }: { site: WebsiteIntegration }) {
  const scope = useSiteScope();
  const queryClient = useQueryClient();
  const t = useTranslations('site.developers.overview');
  const format = useFormatter();
  const now = useNow();
  const [editing, setEditing] = useState(false);
  const [checking, setChecking] = useState(false);
  const installed = tagInstalled(site, now);
  const status = ['active', 'draft', 'suspended', 'archived'].includes(site.status)
    ? (site.status as 'active' | 'draft' | 'suspended' | 'archived')
    : 'draft';

  const check = async () => {
    setChecking(true);
    try {
      await queryClient.invalidateQueries({ queryKey: siteKeys.integration(scope.websiteId) });
      toast.success(t('checked'));
    } finally {
      setChecking(false);
    }
  };

  return (
    <section className='bg-card overflow-hidden rounded-xl border' aria-labelledby='dev-overview'>
      <div className='flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5'>
        <div className='min-w-0'>
          <h2 id='dev-overview' className='truncate text-base font-semibold'>
            {site.name}
          </h2>
          <p className='text-muted-foreground truncate text-sm'>
            {site.primary_domain ?? t('noDomain')}
          </p>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <Badge variant='outline' className={cn('gap-1.5', ENV_STYLE[status])}>
            <Icons.world className='size-3' aria-hidden />
            {t(`env.${status}`)}
          </Badge>
          <Badge variant='outline' className='gap-1.5'>
            <StatusDot on={installed} />
            {installed ? t('tagActive') : t('tagNotDetected')}
          </Badge>
        </div>
      </div>

      <dl className='grid divide-y md:grid-cols-3 md:divide-x md:divide-y-0'>
        <div className='space-y-2 p-4 sm:p-5'>
          <dt className='text-muted-foreground flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase'>
            <Icons.key className='size-3.5' aria-hidden /> {t('siteId')}
          </dt>
          <dd className='space-y-1.5'>
            <CopyField value={site.id} />
            <p className='text-muted-foreground text-xs'>{t('siteIdHint')}</p>
          </dd>
        </div>

        <div className='space-y-2 p-4 sm:p-5'>
          <dt className='text-muted-foreground flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase'>
            <Icons.plug className='size-3.5' aria-hidden /> {t('tag')}
          </dt>
          <dd className='space-y-2'>
            <p className='flex items-center gap-2 text-sm font-medium'>
              <StatusDot on={installed} />
              {installed ? t('tagActive') : t('tagNotDetected')}
            </p>
            <p className='text-muted-foreground text-xs'>
              {site.tag_last_seen_at
                ? t('tagLastSeen', {
                    time: format.relativeTime(new Date(site.tag_last_seen_at), now),
                    origin: site.tag_last_seen_origin ?? '—'
                  })
                : t('tagNeverSeen')}
              {site.tag_version ? ` · v${site.tag_version}` : ''}
            </p>
            <LoadingButton size='sm' variant='outline' loading={checking} onClick={check}>
              <Icons.refresh className='size-3.5' aria-hidden />
              {t('check')}
            </LoadingButton>
          </dd>
        </div>

        <div className='space-y-2 p-4 sm:p-5'>
          <dt className='text-muted-foreground flex items-center justify-between gap-2 text-xs font-medium tracking-wide uppercase'>
            <span className='flex items-center gap-1.5'>
              <Icons.shieldCheck className='size-3.5' aria-hidden /> {t('domains')}
            </span>
            {scope.isPlatformAdmin && (
              <Button
                size='sm'
                variant='ghost'
                className='h-6 px-2 text-xs normal-case'
                onClick={() => setEditing(true)}
              >
                <Icons.edit className='size-3.5' aria-hidden /> {t('editDomains')}
              </Button>
            )}
          </dt>
          <dd className='space-y-1.5'>
            {site.allowed_origins.length ? (
              <ul className='flex flex-wrap gap-1.5'>
                {site.allowed_origins.map((o) => (
                  <li key={o}>
                    <Badge variant='secondary' className='max-w-full font-mono text-[11px]'>
                      <span className='truncate'>{o.replace(/^https?:\/\//, '')}</span>
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className='text-sm'>{t('allOrigins')}</p>
            )}
            <p className='text-muted-foreground text-xs'>
              {t('domainsHint')}
              {!scope.isPlatformAdmin && ` ${t('domainsContact')}`}
            </p>
          </dd>
        </div>
      </dl>

      {scope.isPlatformAdmin && (
        <OriginsDialog site={site} open={editing} onOpenChange={setEditing} />
      )}
    </section>
  );
}

function OriginsDialog({
  site,
  open,
  onOpenChange
}: {
  site: WebsiteIntegration;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const scope = useSiteScope();
  const { adminUpdateWebsite } = useSiteMutations(scope);
  const [origins, setOrigins] = useState(site.allowed_origins.join('\n'));
  const [error, setError] = useState<string | null>(null);
  const t = useTranslations('site.developers.overview');
  const tsv = useTranslations('site.validation');

  const save = () => {
    const list = origins
      .split(/[\s,]+/)
      .map((o) => cleanLine(o).replace(/\/$/, ''))
      .filter(Boolean);
    if (list.length > 20 || list.some((o) => !isWebOrigin(o))) {
      setError(tsv('origin'));
      return;
    }
    adminUpdateWebsite.mutate(
      { allowedOrigins: list },
      {
        onSuccess: () => {
          toast.success(t('originsSaved'));
          onOpenChange(false);
        }
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('domainsDialogTitle')}</DialogTitle>
          <DialogDescription>{t('domainsDialogDescription')}</DialogDescription>
        </DialogHeader>
        <Textarea
          rows={5}
          className='font-mono text-xs'
          value={origins}
          maxLength={4000}
          aria-label={t('domains')}
          aria-invalid={!!error}
          onChange={(e) => {
            setOrigins(e.target.value);
            setError(null);
          }}
          placeholder='https://example.com'
        />
        {error && <p className='text-destructive text-xs'>{error}</p>}
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <LoadingButton loading={adminUpdateWebsite.isPending} onClick={save}>
            {t('save')}
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

'use client';

import { useSuspenseQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { createClient } from '@/lib/supabase/client';
import { formTypeLabel } from '@/features/submissions/lib/fields';
import { useSiteScope } from '@/features/site/components/use-site-scope';
import { capabilitiesQueryOptions } from '../api/queries';
import type { CapabilityKey, SiteCapabilities } from '../api/types';
import { useFormTypeLabel } from './use-labels';
import { useNow } from '../lib/use-now';

const TAG_FRESH_MS = 7 * 24 * 3600 * 1000;

/** Everything the website stores, where it is managed, and the feature that opens it. */
const AREAS: {
  key: CapabilityKey;
  feature?: string[];
  href: string;
  icon: keyof typeof Icons;
}[] = [
  {
    key: 'project_requests',
    feature: ['project_requests'],
    href: '/dashboard/site/project-requests',
    icon: 'briefcase'
  },
  {
    key: 'submissions',
    feature: ['contact_form', 'quotes', 'newsletter'],
    href: '/dashboard/site/requests',
    icon: 'inbox'
  },
  { key: 'payments', feature: ['payments'], href: '/dashboard/site/payments', icon: 'creditCard' },
  {
    key: 'appointments',
    feature: ['bookings'],
    href: '/dashboard/site/appointments',
    icon: 'calendar'
  },
  { key: 'waitlist', feature: ['waitlist'], href: '/dashboard/site/waitlist', icon: 'hourglass' },
  { key: 'services', feature: ['services'], href: '/dashboard/site/services', icon: 'scissors' },
  { key: 'team', feature: ['team'], href: '/dashboard/site/team', icon: 'teams' },
  { key: 'gallery', feature: ['gallery'], href: '/dashboard/site/gallery', icon: 'photo' },
  { key: 'reviews', feature: ['reviews'], href: '/dashboard/site/reviews', icon: 'star' },
  {
    key: 'announcements',
    feature: ['announcements', 'promotions', 'blog'],
    href: '/dashboard/site/announcements',
    icon: 'speakerphone'
  },
  { key: 'faq', href: '/dashboard/site/faq', icon: 'help' },
  {
    key: 'templates',
    feature: ['showcase_cms'],
    href: '/dashboard/site/templates',
    icon: 'template'
  },
  {
    key: 'case-studies',
    feature: ['showcase_cms'],
    href: '/dashboard/site/case-studies',
    icon: 'briefcase'
  },
  {
    key: 'page-sections',
    feature: ['showcase_cms'],
    href: '/dashboard/site/page-sections',
    icon: 'layoutRows'
  },
  { key: 'content_blocks', href: '/dashboard/site/settings', icon: 'page' },
  { key: 'settings', href: '/dashboard/site/settings', icon: 'settings' },
  { key: 'media', href: '/dashboard/site/media', icon: 'media' },
  { key: 'traffic_days', href: '/dashboard/site/analytics', icon: 'chartLine' },
  {
    key: 'studio_projects',
    feature: ['studio_insights'],
    href: '/dashboard/site',
    icon: 'template'
  }
];

/**
 * "Everything about my site": what the website has (features, data, forms
 * detected, integrations) with a link to where each thing is managed. Built
 * from site_capabilities, so a custom form or new content type shows up here
 * as soon as the website sends it.
 */
export function CapabilitiesView() {
  const scope = useSiteScope();
  const { data: caps } = useSuspenseQuery(
    capabilitiesQueryOptions(createClient(), scope.websiteId)
  );
  const t = useTranslations('insights.capabilities');
  if (!caps) return null;
  const features = new Set(caps.features);
  const areas = AREAS.filter(
    (a) => caps.counts[a.key] > 0 || (a.feature ?? []).some((f) => features.has(f))
  );

  return (
    <div className='space-y-6'>
      <section aria-labelledby='areas-title' className='space-y-3'>
        <div>
          <h2 id='areas-title' className='text-base font-semibold'>
            {t('areasTitle')}
          </h2>
          <p className='text-muted-foreground text-sm'>{t('areasDescription')}</p>
        </div>
        <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3'>
          {areas.map((a) => {
            const Icon = Icons[a.icon];
            const count = caps.counts[a.key];
            return (
              <Link
                key={a.key}
                href={a.href}
                className='group'
                aria-label={`${t(`areas.${a.key}.title`)}: ${count}`}
              >
                <Card className='group-hover:bg-muted/40 h-full gap-2 py-4 transition'>
                  <CardHeader className='px-4'>
                    <CardTitle className='flex items-center justify-between gap-2 text-sm'>
                      <span className='flex items-center gap-2'>
                        <Icon className='size-4' aria-hidden /> {t(`areas.${a.key}.title`)}
                      </span>
                      <Badge variant={count > 0 ? 'secondary' : 'outline'} className='tabular-nums'>
                        {count}
                      </Badge>
                    </CardTitle>
                    <CardDescription className='text-xs'>
                      {t(`areas.${a.key}.description`)}
                    </CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            );
          })}
        </div>
      </section>

      <div className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
        <FormsCard caps={caps} />
        <IntegrationsCard caps={caps} />
      </div>

      <div className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
        <FeaturesCard caps={caps} />
        <ContentCard caps={caps} />
      </div>
    </div>
  );
}

function FormsCard({ caps }: { caps: SiteCapabilities }) {
  const t = useTranslations('insights.capabilities');
  const format = useFormatter();
  const typeLabel = useFormTypeLabel();
  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>{t('formsTitle')}</CardTitle>
        <CardDescription>{t('formsDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        {caps.forms.length === 0 ? (
          <p className='text-muted-foreground text-sm'>{t('noForms')}</p>
        ) : (
          <ul className='divide-y text-sm'>
            {caps.forms.map((f) => (
              <li key={f.form_type} className='flex items-center justify-between gap-3 py-2'>
                <Link
                  href={`/dashboard/site/requests?type=${encodeURIComponent(f.form_type)}&view=all`}
                  className='min-w-0 underline-offset-4 hover:underline'
                >
                  <span className='font-medium'>{typeLabel(f.form_type)}</span>
                  <span className='text-muted-foreground ml-2 font-mono text-xs'>
                    {f.form_type}
                  </span>
                </Link>
                <span className='text-muted-foreground flex shrink-0 items-center gap-2 text-xs'>
                  {f.new > 0 && <Badge>{t('newCount', { count: f.new })}</Badge>}
                  {t('formTotal', { count: f.total })}
                  {f.last_at && ` · ${format.relativeTime(new Date(f.last_at))}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function IntegrationsCard({ caps }: { caps: SiteCapabilities }) {
  const now = useNow();
  const t = useTranslations('insights.capabilities');
  const format = useFormatter();
  const seen = caps.tag.last_seen_at ? new Date(caps.tag.last_seen_at) : null;
  const tagActive = !!seen && now - seen.getTime() < TAG_FRESH_MS;
  const rows: { key: string; label: string; status: string; ok: boolean; href: string }[] = [
    {
      key: 'tag',
      label: t('tag'),
      status: seen
        ? t('tagSeen', { date: format.relativeTime(seen), version: caps.tag.version ?? '–' })
        : t('tagNever'),
      ok: tagActive,
      href: '/dashboard/site/developers'
    },
    {
      key: 'analytics',
      label: t('analytics'),
      status: caps.last_visit_day
        ? t('analyticsDays', { count: caps.counts.traffic_days })
        : t('analyticsNone'),
      ok: !!caps.last_visit_day,
      href: '/dashboard/site/analytics'
    },
    {
      key: 'payments',
      label: t('payments'),
      status: caps.last_payment_at
        ? t('lastPayment', { date: format.relativeTime(new Date(caps.last_payment_at)) })
        : t('noPayments'),
      ok: !!caps.last_payment_at,
      href: '/dashboard/site/payments'
    },
    {
      key: 'keys',
      label: t('keys'),
      status: t('activeKeys', { count: caps.counts.api_keys }),
      ok: caps.counts.api_keys > 0,
      href: '/dashboard/site/developers'
    }
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>{t('integrationsTitle')}</CardTitle>
        <CardDescription>{t('integrationsDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className='divide-y text-sm'>
          {rows.map((r) => (
            <li key={r.key} className='flex items-center justify-between gap-3 py-2'>
              <Link href={r.href} className='min-w-0 underline-offset-4 hover:underline'>
                <span className='font-medium'>{r.label}</span>
                <span className='text-muted-foreground block truncate text-xs'>{r.status}</span>
              </Link>
              <Badge variant={r.ok ? 'default' : 'outline'}>
                {r.ok ? <Icons.check className='size-3.5' aria-hidden /> : null}
                {r.ok ? t('connected') : t('notConnected')}
              </Badge>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function FeaturesCard({ caps }: { caps: SiteCapabilities }) {
  const t = useTranslations('insights.capabilities');
  const tf = useTranslations('insights.features');
  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>{t('featuresTitle')}</CardTitle>
        <CardDescription>{t('featuresDescription')}</CardDescription>
      </CardHeader>
      <CardContent className='flex flex-wrap gap-2'>
        {caps.features.length === 0 ? (
          <p className='text-muted-foreground text-sm'>{t('noFeatures')}</p>
        ) : (
          caps.features.map((f) => (
            <Badge key={f} variant='secondary'>
              {tf.has(f as Parameters<typeof tf>[0])
                ? tf(f as Parameters<typeof tf>[0])
                : formTypeLabel(f)}
            </Badge>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function ContentCard({ caps }: { caps: SiteCapabilities }) {
  const t = useTranslations('insights.capabilities');
  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>{t('contentTitle')}</CardTitle>
        <CardDescription>{t('contentDescription')}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-3 text-sm'>
        <div>
          <p className='text-muted-foreground mb-1 text-xs'>{t('pages')}</p>
          <div className='flex flex-wrap gap-1.5'>
            {caps.pages.length ? (
              caps.pages.map((p) => (
                <Badge key={p} variant='outline' className='font-mono'>
                  {p}
                </Badge>
              ))
            ) : (
              <span className='text-muted-foreground'>{t('none')}</span>
            )}
          </div>
        </div>
        <div>
          <p className='text-muted-foreground mb-1 text-xs'>{t('settingsKeys')}</p>
          <div className='flex flex-wrap gap-1.5'>
            {caps.settings_keys.length ? (
              caps.settings_keys.map((k) => (
                <Badge key={k} variant='outline' className='font-mono'>
                  {k}
                </Badge>
              ))
            ) : (
              <span className='text-muted-foreground'>{t('none')}</span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

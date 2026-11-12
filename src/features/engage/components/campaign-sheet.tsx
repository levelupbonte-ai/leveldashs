'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useErrorMessage } from '@/hooks/use-error-message';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import { useFields } from '@/lib/validation/use-fields';
import { useSiteScope } from '@/features/site/components/use-site-scope';
import { engageKeys } from '../api/queries';
import { saveCampaign } from '../api/service';
import type { Campaign, CampaignInput, CampaignKind, CampaignTheme } from '../api/types';
import { CampaignPreview } from './campaign-preview';
import { fromLocalInput, toLocalInput } from './dates';

/** Create or edit a campaign; the preview follows every change. */
export function CampaignSheet({
  open,
  campaign,
  onOpenChange
}: {
  open: boolean;
  campaign: Campaign | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('engage.campaigns.editor');
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className='w-full overflow-y-auto sm:max-w-2xl'>
        <SheetHeader>
          <SheetTitle>{campaign ? t('editTitle') : t('newTitle')}</SheetTitle>
          <SheetDescription>{t('description')}</SheetDescription>
        </SheetHeader>
        {open && <CampaignForm campaign={campaign} onDone={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  );
}

function CampaignForm({ campaign, onDone }: { campaign: Campaign | null; onDone: () => void }) {
  const scope = useSiteScope();
  const t = useTranslations('engage.campaigns.editor');
  const tv = useTranslations('validation');
  const f = useFields();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();

  const schema = useMemo(
    () =>
      z
        .object({
          name: f.text(80, { min: 1 }),
          kind: z.enum(['bar', 'popup', 'slot']),
          live: z.boolean(),
          frTitle: f.text(80),
          frText: f.text(300, { multiline: true }),
          frCta: f.text(40),
          enTitle: f.text(80),
          enText: f.text(300, { multiline: true }),
          enCta: f.text(40),
          ctaUrl: f.url({ httpsOnly: true }),
          coupon: z.string().regex(/^([A-Za-z0-9_-]{2,32})?$/, tv('invalid')),
          countdownTo: z.string(),
          startsAt: z.string(),
          endsAt: z.string(),
          pages: f.text(4000, { multiline: true }),
          slot: z.string().regex(/^([a-z0-9-]{1,40})?$/, tv('invalid')),
          position: z.enum(['top', 'bottom']),
          delay: z.number().int().min(0).max(120),
          frequency: z.enum(['always', 'session', 'once']),
          theme: z.enum(['dark', 'light', 'accent']),
          accent: z.string().regex(/^(#[0-9a-fA-F]{6})?$/, tv('color')),
          priority: z.number().int().min(0).max(100)
        })
        .superRefine((v, ctx) => {
          if (!v.frTitle && !v.frText && !v.enTitle && !v.enText) {
            ctx.addIssue({ code: 'custom', path: ['frTitle'], message: t('needText') });
          }
          if (v.ctaUrl && !v.ctaUrl.startsWith('https://')) {
            ctx.addIssue({ code: 'custom', path: ['ctaUrl'], message: t('httpsOnly') });
          }
          if (v.kind === 'slot' && !v.slot) {
            ctx.addIssue({ code: 'custom', path: ['slot'], message: tv('required') });
          }
          if (v.startsAt && v.endsAt && v.endsAt <= v.startsAt) {
            ctx.addIssue({ code: 'custom', path: ['endsAt'], message: t('endAfterStart') });
          }
          const pages = v.pages
            .split('\n')
            .map((x) => x.trim())
            .filter(Boolean);
          if (pages.length > 20 || pages.some((p) => !/^\/[^\s<>"]{0,200}$/.test(p))) {
            ctx.addIssue({ code: 'custom', path: ['pages'], message: t('pagesInvalid') });
          }
        }),
    [f, t, tv]
  );

  const form = useAppForm({
    defaultValues: {
      name: campaign?.name ?? '',
      kind: (campaign?.kind ?? 'bar') as CampaignKind,
      live: campaign ? campaign.status === 'active' : false,
      frTitle: campaign?.content.fr?.title ?? '',
      frText: campaign?.content.fr?.text ?? '',
      frCta: campaign?.content.fr?.cta ?? '',
      enTitle: campaign?.content.en?.title ?? '',
      enText: campaign?.content.en?.text ?? '',
      enCta: campaign?.content.en?.cta ?? '',
      ctaUrl: campaign?.cta_url ?? '',
      coupon: campaign?.coupon_code ?? '',
      countdownTo: toLocalInput(campaign?.countdown_to ?? null),
      startsAt: toLocalInput(campaign?.starts_at ?? null),
      endsAt: toLocalInput(campaign?.ends_at ?? null),
      pages: (campaign?.pages ?? []).join('\n'),
      slot: campaign?.slot ?? '',
      position: campaign?.position ?? 'bottom',
      delay: campaign?.delay_seconds ?? 3,
      frequency: campaign?.frequency ?? 'session',
      theme: (campaign?.theme ?? 'dark') as CampaignTheme,
      accent: campaign?.accent ?? '',
      priority: campaign?.priority ?? 0
    },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      const v = schema.parse(value);
      const input: CampaignInput = {
        name: v.name,
        kind: v.kind,
        status: v.live
          ? 'active'
          : campaign && campaign.status !== 'active'
            ? campaign.status
            : 'draft',
        content: {
          fr: {
            title: v.frTitle || undefined,
            text: v.frText || undefined,
            cta: v.frCta || undefined
          },
          en: {
            title: v.enTitle || undefined,
            text: v.enText || undefined,
            cta: v.enCta || undefined
          }
        },
        cta_url: v.ctaUrl || null,
        coupon_code: v.coupon || null,
        countdown_to: fromLocalInput(v.countdownTo),
        starts_at: fromLocalInput(v.startsAt),
        ends_at: fromLocalInput(v.endsAt),
        pages: v.pages
          .split('\n')
          .map((x) => x.trim())
          .filter(Boolean),
        slot: v.kind === 'slot' ? v.slot : null,
        position: v.position,
        delay_seconds: v.delay,
        frequency: v.frequency,
        theme: v.theme,
        accent: v.accent || null,
        priority: v.priority
      };
      try {
        await saveCampaign(createClient(), scope.websiteId, campaign?.id ?? null, input);
        toast.success(v.live ? t('savedLive') : t('saved'));
        void queryClient.invalidateQueries({ queryKey: engageKeys.campaigns(scope.websiteId) });
        onDone();
      } catch (error) {
        toast.error(errorMessage(error));
      }
    }
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
      className='flex flex-col gap-5 px-4 pb-4'
    >
      <form.Subscribe
        selector={(s) => ({
          kind: s.values.kind,
          theme: s.values.theme,
          accent: s.values.accent,
          fr: { title: s.values.frTitle, text: s.values.frText, cta: s.values.frCta },
          en: { title: s.values.enTitle, text: s.values.enText, cta: s.values.enCta },
          coupon: s.values.coupon,
          countdown: !!s.values.countdownTo,
          hasLink: !!s.values.ctaUrl
        })}
      >
        {(p) => (
          <CampaignPreview
            kind={p.kind}
            theme={p.theme}
            accent={p.accent}
            text={p.fr.title || p.fr.text ? p.fr : p.en}
            coupon={p.coupon}
            countdown={p.countdown}
            hasLink={p.hasLink}
          />
        )}
      </form.Subscribe>

      <FieldGroup>
        <form.AppField
          name='name'
          children={(field) => (
            <field.TextField
              label={t('name')}
              description={t('nameHint')}
              maxLength={80}
              required
            />
          )}
        />
        <form.AppField
          name='kind'
          children={(field) => (
            <field.RadioGroupField
              label={t('kind')}
              description={t('kindHint')}
              options={(['bar', 'popup', 'slot'] as const).map((k) => ({
                value: k,
                label: t(`kinds.${k}`)
              }))}
            />
          )}
        />
        <form.AppField
          name='live'
          children={(field) => <field.SwitchField label={t('live')} description={t('liveHint')} />}
        />
      </FieldGroup>

      <Tabs defaultValue='fr'>
        <TabsList>
          <TabsTrigger value='fr'>{t('french')}</TabsTrigger>
          <TabsTrigger value='en'>{t('english')}</TabsTrigger>
        </TabsList>
        {(['fr', 'en'] as const).map((l) => (
          <TabsContent key={l} value={l} className='mt-3'>
            <FieldGroup>
              <form.AppField
                name={l === 'fr' ? 'frTitle' : 'enTitle'}
                children={(field) => <field.TextField label={t('titleLabel')} maxLength={80} />}
              />
              <form.AppField
                name={l === 'fr' ? 'frText' : 'enText'}
                children={(field) => (
                  <field.TextareaField label={t('text')} rows={2} maxLength={300} />
                )}
              />
              <form.AppField
                name={l === 'fr' ? 'frCta' : 'enCta'}
                children={(field) => (
                  <field.TextField
                    label={t('cta')}
                    placeholder={t('ctaPlaceholder')}
                    maxLength={40}
                  />
                )}
              />
            </FieldGroup>
          </TabsContent>
        ))}
      </Tabs>

      <FieldGroup>
        <form.AppField
          name='ctaUrl'
          children={(field) => (
            <field.TextField
              label={t('ctaUrl')}
              placeholder='https://'
              type='url'
              inputMode='url'
              showCount={false}
            />
          )}
        />
        <div className='grid gap-4 sm:grid-cols-2'>
          <form.AppField
            name='coupon'
            children={(field) => (
              <field.TextField
                label={t('coupon')}
                description={t('couponHint')}
                maxLength={32}
                showCount={false}
                autoCapitalize='characters'
              />
            )}
          />
          <form.AppField
            name='countdownTo'
            children={(field) => (
              <field.TextField
                label={t('countdown')}
                description={t('countdownHint')}
                type='datetime-local'
              />
            )}
          />
        </div>
        <div className='grid gap-4 sm:grid-cols-2'>
          <form.AppField
            name='startsAt'
            children={(field) => <field.TextField label={t('startsAt')} type='datetime-local' />}
          />
          <form.AppField
            name='endsAt'
            children={(field) => (
              <field.TextField
                label={t('endsAt')}
                description={t('endsAtHint')}
                type='datetime-local'
              />
            )}
          />
        </div>
        <form.AppField
          name='pages'
          children={(field) => (
            <field.TextareaField label={t('pages')} description={t('pagesHint')} rows={3} />
          )}
        />
        <form.Subscribe selector={(s) => s.values.kind}>
          {(kind) => (
            <>
              {kind === 'slot' && (
                <form.AppField
                  name='slot'
                  children={(field) => (
                    <field.TextField
                      label={t('slot')}
                      description={t('slotHint')}
                      placeholder='prix'
                      maxLength={40}
                      showCount={false}
                    />
                  )}
                />
              )}
              {kind === 'bar' && (
                <form.AppField
                  name='position'
                  children={(field) => (
                    <field.SelectField
                      label={t('position')}
                      options={[
                        { value: 'bottom', label: t('positions.bottom') },
                        { value: 'top', label: t('positions.top') }
                      ]}
                    />
                  )}
                />
              )}
              {kind === 'popup' && (
                <form.AppField
                  name='delay'
                  children={(field) => (
                    <field.TextField
                      label={t('delay')}
                      type='number'
                      min={0}
                      max={120}
                      inputMode='numeric'
                    />
                  )}
                />
              )}
            </>
          )}
        </form.Subscribe>
        <div className='grid gap-4 sm:grid-cols-2'>
          <form.AppField
            name='frequency'
            children={(field) => (
              <field.SelectField
                label={t('frequency')}
                options={(['session', 'once', 'always'] as const).map((k) => ({
                  value: k,
                  label: t(`frequencies.${k}`)
                }))}
              />
            )}
          />
          <form.AppField
            name='theme'
            children={(field) => (
              <field.SelectField
                label={t('theme')}
                options={(['dark', 'light', 'accent'] as const).map((k) => ({
                  value: k,
                  label: t(`themes.${k}`)
                }))}
              />
            )}
          />
        </div>
        <div className='grid gap-4 sm:grid-cols-2'>
          <form.AppField
            name='accent'
            children={(field) => (
              <field.ColorField label={t('accent')} description={t('accentHint')} />
            )}
          />
          <form.AppField
            name='priority'
            children={(field) => (
              <field.TextField
                label={t('priority')}
                description={t('priorityHint')}
                type='number'
                min={0}
                max={100}
                inputMode='numeric'
              />
            )}
          />
        </div>
      </FieldGroup>

      <SheetFooter className='flex-row justify-end gap-2 px-0'>
        <Button type='button' variant='outline' onClick={onDone}>
          {t('cancel')}
        </Button>
        <form.AppForm>
          <form.SubmitButton>{t('save')}</form.SubmitButton>
        </form.AppForm>
      </SheetFooter>
    </form>
  );
}

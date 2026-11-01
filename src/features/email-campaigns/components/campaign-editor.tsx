'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';
import { Icons } from '@/components/icons';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useSiteScope } from '@/features/site/components/use-site-scope';
import { useErrorMessage } from '@/hooks/use-error-message';
import { useAppForm } from '@/lib/form';
import { createClient } from '@/lib/supabase/client';
import { safeHttpUrl } from '@/lib/validation/sanitize';
import { PlanLimitNotice } from '@/features/billing/components/plan-limit-notice';
import { PlanLimitError } from '@/lib/plan-limit';
import { emailKeys } from '../api/queries';
import {
  campaignToDraft,
  saveCampaign,
  scheduleCampaign,
  sendCampaign,
  sendTestEmail
} from '../api/service';
import type { Campaign, CampaignValues, EmailOverview } from '../api/types';
import {
  BODY_MAX,
  BUTTON_LABEL_MAX,
  CAMPAIGN_TEMPLATES,
  HEADING_MAX,
  PREVIEW_MAX,
  SUBJECT_MAX,
  renderCampaign,
  type CampaignTemplate
} from '../lib/render';
import { imageUrlFor, labelsFor, toCampaignBrand, useEmailConfig } from './email-context';
import { EmailPreview } from './email-preview';
import { MediaPicker } from './media-picker';
import { CampaignStatusBadge } from './status-badge';
import { TemplatePicker } from './template-picker';
import { useTemplateDefaults } from './use-template-defaults';

interface FormValues {
  template: CampaignTemplate;
  locale: 'en' | 'fr';
  subject: string;
  preview_text: string;
  heading: string;
  body: string;
  button_label: string;
  button_url: string;
  image_media_id: string;
}

function toValues(v: FormValues): CampaignValues {
  return {
    template: v.template,
    locale: v.locale,
    subject: v.subject.trim(),
    preview_text: v.preview_text.trim(),
    heading: v.heading.trim(),
    body: v.body.trim(),
    button_label: v.button_label.trim() || null,
    button_url: v.button_url.trim() || null,
    image_media_id: v.image_media_id || null
  };
}

/**
 * Create / edit a campaign: template, subject, preview text, heading, body,
 * button and image, with the live e-mail beside it (desktop and phone). Drafts
 * are saved by editors; owners and admins send a test, schedule or send.
 * Campaigns already scheduled or sent open read-only with their numbers.
 */
export function CampaignEditor({
  campaign,
  overview,
  onSaved,
  onSent,
  onOpenSender
}: {
  campaign: Campaign | null;
  overview: EmailOverview;
  onSaved: (id: string) => void;
  onSent: () => void;
  onOpenSender: () => void;
}) {
  if (campaign && campaign.status !== 'draft') {
    return <CampaignDetails campaign={campaign} overview={overview} />;
  }
  return (
    <DraftEditor
      campaign={campaign}
      overview={overview}
      onSaved={onSaved}
      onSent={onSent}
      onOpenSender={onOpenSender}
    />
  );
}

function DraftEditor({
  campaign,
  overview,
  onSaved,
  onSent,
  onOpenSender
}: {
  campaign: Campaign | null;
  overview: EmailOverview;
  onSaved: (id: string) => void;
  onSent: () => void;
  onOpenSender: () => void;
}) {
  const t = useTranslations('emailCampaigns.editor');
  const tv = useTranslations('validation');
  const scope = useSiteScope();
  const config = useEmailConfig();
  const defaults = useTemplateDefaults();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const uiLocale = useLocale();
  const db = createClient();
  const canEdit = overview.can_edit;
  const canSend = overview.can_send;
  const [savedId, setSavedId] = useState<string | null>(campaign?.id ?? null);
  const [imageUrl, setImageUrl] = useState<string | null>(
    imageUrlFor(campaign?.image_path ?? null)
  );
  const [confirmSend, setConfirmSend] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [limit, setLimit] = useState<PlanLimitError | null>(null);
  const brand = useMemo(() => toCampaignBrand(overview.brand), [overview.brand]);
  const ready = overview.missing.length === 0;

  const initial: FormValues = useMemo(() => {
    if (campaign) {
      return {
        template: campaign.template,
        locale: campaign.locale,
        subject: campaign.subject,
        preview_text: campaign.preview_text,
        heading: campaign.heading,
        body: campaign.body,
        button_label: campaign.button_label ?? '',
        button_url: campaign.button_url ?? '',
        image_media_id: campaign.image_media_id ?? ''
      };
    }
    const d = defaults('newsletter');
    return {
      template: 'newsletter',
      locale: uiLocale === 'fr' ? 'fr' : 'en',
      subject: d.subject,
      preview_text: d.previewText,
      heading: d.heading,
      body: d.body,
      button_label: '',
      button_url: '',
      image_media_id: ''
    };
    // Only the first render: the form owns the values afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const schema = useMemo(
    () =>
      z
        .object({
          template: z.enum(CAMPAIGN_TEMPLATES),
          locale: z.enum(['en', 'fr']),
          subject: z
            .string()
            .trim()
            .min(1, { message: tv('required') })
            .max(SUBJECT_MAX, { message: tv('maxLength', { max: SUBJECT_MAX }) }),
          preview_text: z
            .string()
            .max(PREVIEW_MAX, { message: tv('maxLength', { max: PREVIEW_MAX }) }),
          heading: z.string().max(HEADING_MAX, { message: tv('maxLength', { max: HEADING_MAX }) }),
          body: z.string().max(BODY_MAX, { message: tv('maxLength', { max: BODY_MAX }) }),
          button_label: z
            .string()
            .max(BUTTON_LABEL_MAX, { message: tv('maxLength', { max: BUTTON_LABEL_MAX }) }),
          button_url: z
            .string()
            .trim()
            .refine((v) => !v || safeHttpUrl(v) !== null, { message: t('buttonUrlInvalid') }),
          image_media_id: z.string()
        })
        .refine((v) => !v.button_label.trim() === !v.button_url.trim(), {
          message: t('buttonIncomplete'),
          path: ['button_url']
        })
        .refine((v) => v.heading.trim() || v.body.trim(), {
          message: t('contentRequired'),
          path: ['body']
        }),
    [tv, t]
  );

  const save = useMutation({
    mutationFn: (values: FormValues) =>
      saveCampaign(db, scope.websiteId, savedId, toValues(values)),
    onSuccess: async (saved) => {
      setSavedId(saved.id);
      await queryClient.invalidateQueries({ queryKey: emailKeys.all(scope.websiteId) });
    }
  });

  const form = useAppForm({
    defaultValues: initial,
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      try {
        const saved = await save.mutateAsync(value);
        toast.success(t('saved'));
        if (!campaign) onSaved(saved.id);
      } catch (e) {
        toast.error(errorMessage(e, 'saveFailed'));
      }
    }
  });

  /** Validates, saves, then runs the action with the saved id. */
  const saveThen = async (action: (id: string) => Promise<void>) => {
    await form.validateAllFields('submit');
    const result = schema.safeParse(form.state.values);
    if (!result.success) {
      await form.handleSubmit();
      return;
    }
    try {
      const saved = await save.mutateAsync(form.state.values);
      await action(saved.id);
    } catch (e) {
      if (e instanceof PlanLimitError) setLimit(e);
      toast.error(errorMessage(e, 'saveFailed'));
    }
  };

  const test = useMutation({
    mutationFn: () =>
      saveThen(async (id) => {
        const res = await sendTestEmail(id);
        toast.success(t('testSent', { email: res.to }));
      })
  });
  const send = useMutation({
    mutationFn: () =>
      saveThen(async (id) => {
        const res = await sendCampaign(id);
        await queryClient.invalidateQueries({ queryKey: emailKeys.all(scope.websiteId) });
        toast.success(t('sending', { count: res.recipients ?? 0 }));
        onSent();
      })
  });
  const lastSchedule = useRef<Date | null>(null);
  const schedule = useMutation({
    mutationFn: () =>
      saveThen(async (id) => {
        if (!lastSchedule.current) return;
        await scheduleCampaign(db, id, lastSchedule.current);
        await queryClient.invalidateQueries({ queryKey: emailKeys.all(scope.websiteId) });
        setScheduleOpen(false);
        toast.success(t('scheduled'));
        onSent();
      })
  });
  const busy = save.isPending || test.isPending || send.isPending || schedule.isPending;

  return (
    <div className='grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]'>
      <form
        id='campaign-form'
        className='min-w-0 space-y-6'
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        {limit && <PlanLimitNotice info={limit.info} />}
        {!ready && (
          <Alert>
            <Icons.alertCircle className='size-4' aria-hidden />
            <AlertTitle>{t('senderMissingTitle')}</AlertTitle>
            <AlertDescription>
              <p>{t('senderMissing')}</p>
              {canSend && (
                <Button
                  type='button'
                  size='sm'
                  variant='outline'
                  className='mt-2'
                  onClick={onOpenSender}
                >
                  {t('openSender')}
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}
        <Card>
          <CardHeader>
            <CardTitle>{t('templateTitle')}</CardTitle>
            <CardDescription>{t('templateDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form.Subscribe selector={(s) => s.values.locale}>
              {(locale) => (
                <form.Field
                  name='template'
                  children={(field) => (
                    <TemplatePicker
                      value={field.state.value}
                      disabled={!canEdit}
                      brand={brand}
                      labels={labelsFor(config.footerLabels, locale, overview.brand)}
                      locale={locale}
                      onChange={(next) => {
                        // Keep what the user wrote; replace the copy only while it is the previous template's.
                        const before = defaults(field.state.value);
                        const after = defaults(next);
                        const v = form.state.values;
                        if (!v.subject || v.subject === before.subject)
                          form.setFieldValue('subject', after.subject);
                        if (!v.preview_text || v.preview_text === before.previewText)
                          form.setFieldValue('preview_text', after.previewText);
                        if (!v.heading || v.heading === before.heading)
                          form.setFieldValue('heading', after.heading);
                        if (!v.body || v.body === before.body)
                          form.setFieldValue('body', after.body);
                        if (!v.button_label || v.button_label === (before.buttonLabel ?? ''))
                          form.setFieldValue(
                            'button_label',
                            v.button_url ? (after.buttonLabel ?? '') : ''
                          );
                        field.handleChange(next);
                      }}
                    />
                  )}
                />
              )}
            </form.Subscribe>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('contentTitle')}</CardTitle>
            <CardDescription>{t('contentDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <fieldset disabled={!canEdit || busy} className='contents'>
              <FieldGroup>
                <form.AppField
                  name='locale'
                  children={(field) => (
                    <field.SelectField
                      label={t('locale')}
                      description={t('localeHint')}
                      options={[
                        { value: 'en', label: t('locales.en') },
                        { value: 'fr', label: t('locales.fr') }
                      ]}
                    />
                  )}
                />
                <form.AppField
                  name='subject'
                  children={(field) => (
                    <field.TextField label={t('subject')} required maxLength={SUBJECT_MAX} />
                  )}
                />
                <form.AppField
                  name='preview_text'
                  children={(field) => (
                    <field.TextField
                      label={t('previewText')}
                      description={t('previewTextHint')}
                      maxLength={PREVIEW_MAX}
                    />
                  )}
                />
                <form.AppField
                  name='heading'
                  children={(field) => (
                    <field.TextField label={t('heading')} maxLength={HEADING_MAX} />
                  )}
                />
                <form.AppField
                  name='body'
                  children={(field) => (
                    <field.TextareaField
                      label={t('body')}
                      description={t('bodyHint')}
                      rows={10}
                      maxLength={BODY_MAX}
                    />
                  )}
                />
                <div className='grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]'>
                  <form.AppField
                    name='button_label'
                    children={(field) => (
                      <field.TextField label={t('buttonLabel')} maxLength={BUTTON_LABEL_MAX} />
                    )}
                  />
                  <form.AppField
                    name='button_url'
                    children={(field) => (
                      <field.TextField
                        label={t('buttonUrl')}
                        type='url'
                        inputMode='url'
                        placeholder='https://'
                        maxLength={2048}
                      />
                    )}
                  />
                </div>
                <form.Field
                  name='image_media_id'
                  children={(field) => (
                    <Field>
                      <FieldLabel>{t('image')}</FieldLabel>
                      <MediaPicker
                        websiteId={scope.websiteId}
                        value={field.state.value ? imageUrl : null}
                        disabled={!canEdit || busy}
                        onChange={(item) => {
                          field.handleChange(item?.id ?? '');
                          setImageUrl(item?.url ?? null);
                        }}
                      />
                      <FieldDescription>{t('imageHint')}</FieldDescription>
                    </Field>
                  )}
                />
              </FieldGroup>
            </fieldset>
          </CardContent>
        </Card>

        {canEdit && (
          <div className='bg-background/95 sticky bottom-0 z-10 flex flex-wrap gap-2 border-t py-3 backdrop-blur'>
            <Button
              disabled={save.isPending && !test.isPending && !send.isPending}
              type='submit'
              variant='outline'
            >
              <Icons.check className='size-4' aria-hidden />
              {t('save')}
            </Button>
            <Button
              type='button'
              variant='outline'
              disabled={!ready || !config.providerReady || busy || test.isPending}
              onClick={() => test.mutate()}
            >
              <Icons.mail className='size-4' aria-hidden />
              {t('sendTest')}
            </Button>
            {canSend && config.schedulingAvailable && (
              <Button
                type='button'
                variant='outline'
                disabled={!ready || !!overview.paused || busy}
                onClick={() => setScheduleOpen(true)}
              >
                <Icons.clock className='size-4' aria-hidden />
                {t('schedule')}
              </Button>
            )}
            {canSend && (
              <Button
                type='button'
                disabled={
                  !ready ||
                  !config.providerReady ||
                  !!overview.paused ||
                  busy ||
                  overview.contacts.subscribed === 0 ||
                  send.isPending
                }
                onClick={() => setConfirmSend(true)}
              >
                <Icons.send className='size-4' aria-hidden />
                {t('sendNow')}
              </Button>
            )}
            {!canSend && (
              <p className='text-muted-foreground self-center text-xs'>{t('editorsDraft')}</p>
            )}
          </div>
        )}
      </form>

      <div className='min-w-0 xl:sticky xl:top-4 xl:self-start'>
        <form.Subscribe selector={(s) => s.values}>
          {(values) => (
            <LivePreview
              values={values}
              imageUrl={values.image_media_id ? imageUrl : null}
              overview={overview}
            />
          )}
        </form.Subscribe>
      </div>

      <AlertDialog open={confirmSend} onOpenChange={setConfirmSend}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('confirmDescription', {
                count: overview.contacts.subscribed,
                business: overview.brand.business_name
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmSend(false);
                send.mutate();
              }}
            >
              {t('confirmSend', { count: overview.contacts.subscribed })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ScheduleDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        pending={schedule.isPending}
        count={overview.contacts.subscribed}
        onConfirm={(at) => {
          lastSchedule.current = at;
          schedule.mutate();
        }}
      />
    </div>
  );
}

function LivePreview({
  values,
  imageUrl,
  overview
}: {
  values: FormValues;
  imageUrl: string | null;
  overview: EmailOverview;
}) {
  const config = useEmailConfig();
  const html = useMemo(
    () =>
      renderCampaign(
        {
          template: values.template,
          locale: values.locale,
          subject: values.subject,
          previewText: values.preview_text,
          heading: values.heading,
          body: values.body,
          buttonLabel: values.button_label || null,
          buttonUrl: values.button_url || null,
          imageUrl
        },
        toCampaignBrand(overview.brand),
        labelsFor(config.footerLabels, values.locale, overview.brand),
        { unsubscribeUrl: null, preview: true }
      ).html,
    [values, imageUrl, overview.brand, config.footerLabels]
  );
  return <EmailPreview html={html} />;
}

function ScheduleDialog({
  open,
  onOpenChange,
  pending,
  count,
  onConfirm
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  count: number;
  onConfirm: (at: Date) => void;
}) {
  const t = useTranslations('emailCampaigns.editor');
  const [value, setValue] = useState('');
  const [invalid, setInvalid] = useState(false);
  const confirm = () => {
    const at = new Date(value);
    const now = Date.now();
    const ok =
      !Number.isNaN(at.getTime()) &&
      at.getTime() > now + 10 * 60_000 &&
      at.getTime() < now + 89 * 86_400_000;
    setInvalid(!ok);
    if (ok) onConfirm(at);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>{t('scheduleTitle')}</DialogTitle>
          <DialogDescription>{t('scheduleDescription', { count })}</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor='schedule-at'>{t('scheduleAt')}</FieldLabel>
          <Input
            id='schedule-at'
            type='datetime-local'
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setInvalid(false);
            }}
            aria-invalid={invalid}
          />
          <FieldDescription className={invalid ? 'text-destructive' : undefined}>
            {t('scheduleHint')}
          </FieldDescription>
        </Field>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button disabled={!value || pending} onClick={confirm}>
            {t('scheduleConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A scheduled, sending, sent or failed campaign: its e-mail and its real numbers. */
function CampaignDetails({ campaign, overview }: { campaign: Campaign; overview: EmailOverview }) {
  const t = useTranslations('emailCampaigns.details');
  const tl = useTranslations('emailCampaigns.list');
  const config = useEmailConfig();
  const format = useFormatter();
  const scope = useSiteScope();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const toDraft = useMutation({
    mutationFn: () => campaignToDraft(createClient(), campaign.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: emailKeys.all(scope.websiteId) }),
    onError: (e) => toast.error(errorMessage(e))
  });
  const s = campaign.stats;
  const tiles: { key: string; label: string; value: number; hidden?: boolean }[] = [
    { key: 'recipients', label: t('recipients'), value: campaign.recipient_count },
    { key: 'sent', label: t('sent'), value: s.sent },
    {
      key: 'delivered',
      label: t('delivered'),
      value: s.delivered,
      hidden: !overview.delivery_tracking
    },
    { key: 'bounced', label: t('bounced'), value: s.bounced, hidden: !overview.delivery_tracking },
    { key: 'unsubscribed', label: t('unsubscribed'), value: s.unsubscribed },
    { key: 'failed', label: t('failed'), value: s.failed + s.skipped }
  ];
  const html = useMemo(
    () =>
      renderCampaign(
        {
          template: campaign.template,
          locale: campaign.locale,
          subject: campaign.subject,
          previewText: campaign.preview_text,
          heading: campaign.heading,
          body: campaign.body,
          buttonLabel: campaign.button_label,
          buttonUrl: campaign.button_url,
          imageUrl: imageUrlFor(campaign.image_path)
        },
        toCampaignBrand(overview.brand),
        labelsFor(config.footerLabels, campaign.locale, overview.brand),
        { unsubscribeUrl: null, preview: true }
      ).html,
    [campaign, overview.brand, config.footerLabels]
  );
  const date = (iso: string | null) =>
    iso ? format.dateTime(new Date(iso), { dateStyle: 'long', timeStyle: 'short' }) : '—';

  return (
    <div className='grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]'>
      <div className='min-w-0 space-y-6'>
        <Card>
          <CardHeader className='gap-2'>
            <div className='flex flex-wrap items-center gap-2'>
              <CampaignStatusBadge status={campaign.status} />
              {campaign.status === 'failed' && campaign.failure_reason && (
                <span className='text-destructive text-sm'>
                  {tl(`failure.${campaign.failure_reason}`)}
                </span>
              )}
            </div>
            <CardTitle className='text-lg'>{campaign.subject}</CardTitle>
            <CardDescription>
              {campaign.status === 'scheduled'
                ? t('scheduledFor', { date: date(campaign.scheduled_at) })
                : t('startedAt', { date: date(campaign.started_at) })}
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-4'>
            {campaign.status !== 'scheduled' && (
              <dl className='grid grid-cols-2 gap-3 sm:grid-cols-3'>
                {tiles
                  .filter((x) => !x.hidden)
                  .map((x) => (
                    <div key={x.key} className='bg-muted/30 rounded-lg border p-3'>
                      <dt className='text-muted-foreground text-xs'>{x.label}</dt>
                      <dd className='text-xl font-semibold tabular-nums'>
                        {format.number(x.value)}
                      </dd>
                    </div>
                  ))}
              </dl>
            )}
            {!overview.delivery_tracking && campaign.status !== 'scheduled' && (
              <p className='text-muted-foreground text-xs'>{tl('trackingOff')}</p>
            )}
            <p className='text-muted-foreground text-xs'>{t('noOpens')}</p>
            {overview.can_send &&
              (campaign.status === 'scheduled' ||
                (campaign.status === 'failed' && campaign.recipient_count === 0)) && (
                <Button
                  disabled={toDraft.isPending}
                  variant='outline'
                  onClick={() => toDraft.mutate()}
                >
                  <Icons.edit className='size-4' aria-hidden />
                  {campaign.status === 'scheduled' ? t('unschedule') : t('backToDraft')}
                </Button>
              )}
          </CardContent>
        </Card>
      </div>
      <div className='min-w-0'>
        <EmailPreview html={html} />
      </div>
    </div>
  );
}

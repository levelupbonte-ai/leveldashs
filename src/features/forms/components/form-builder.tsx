'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useErrorMessage } from '@/hooks/use-error-message';
import { useSiteScope } from '@/features/site/components/use-site-scope';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { formKeys } from '../api/queries';
import { saveForm } from '../api/service';
import {
  FIELD_TYPES,
  type FieldMap,
  FORM_TYPES,
  type FieldType,
  type FormField,
  type FormSettings,
  type SiteFormInput
} from '../api/types';
import { fieldIdFrom } from '../lib/fields';
import { FormRenderer } from './form-renderer';
import { ShareForm } from './share-form';

const CHOICE_TYPES: FieldType[] = ['select', 'radio', 'multiselect'];
const NO_PLACEHOLDER: FieldType[] = ['checkbox', 'file', 'rating', 'section'];
/** Which standard request column each type can fill. */
const MAPS_FOR: Partial<Record<FieldType, readonly string[]>> = {
  text: ['name', 'company', 'message'],
  email: ['email'],
  phone: ['phone'],
  textarea: ['message']
};

function Row({
  label,
  children,
  hint
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className='grid gap-1.5'>
      <span className='text-sm font-medium'>{label}</span>
      {children}
      {hint && <p className='text-muted-foreground text-xs'>{hint}</p>}
    </div>
  );
}

function FieldEditor({
  field,
  index,
  count,
  others,
  onChange,
  onMove,
  onRemove,
  open,
  onToggle
}: {
  field: FormField;
  index: number;
  count: number;
  others: FormField[];
  onChange: (f: FormField) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  open: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations('siteForms.builder');
  const mapsAllowed = (MAPS_FOR[field.type] ?? []).filter(
    (m) => m === field.maps || !others.some((o) => o.maps === m)
  );
  return (
    <li className='rounded-lg border'>
      <div className='flex items-center gap-1 p-2'>
        <button
          type='button'
          onClick={onToggle}
          aria-expanded={open}
          className='flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-sm'
        >
          <Icons.chevronRight
            className={cn('size-4 shrink-0 transition', open && 'rotate-90')}
            aria-hidden
          />
          <span className='truncate font-medium'>{field.label || t('untitled')}</span>
          <Badge variant='outline' className='shrink-0 font-normal'>
            {t(`types.${field.type}`)}
          </Badge>
          {field.required && (
            <span className='text-muted-foreground shrink-0 text-xs'>{t('requiredShort')}</span>
          )}
        </button>
        <Button
          type='button'
          variant='ghost'
          size='icon'
          className='size-9'
          disabled={index === 0}
          onClick={() => onMove(-1)}
          aria-label={t('moveUp')}
        >
          <Icons.chevronUp className='size-4' aria-hidden />
        </Button>
        <Button
          type='button'
          variant='ghost'
          size='icon'
          className='size-9'
          disabled={index === count - 1}
          onClick={() => onMove(1)}
          aria-label={t('moveDown')}
        >
          <Icons.chevronDown className='size-4' aria-hidden />
        </Button>
        <Button
          type='button'
          variant='ghost'
          size='icon'
          className='size-9'
          onClick={onRemove}
          aria-label={t('remove')}
        >
          <Icons.trash className='size-4' aria-hidden />
        </Button>
      </div>
      {open && (
        <div className='grid gap-4 border-t p-3 sm:grid-cols-2'>
          <Row label={t('label')}>
            <Input
              value={field.label}
              maxLength={120}
              onChange={(e) => onChange({ ...field, label: e.target.value })}
            />
          </Row>
          <Row label={t('type')}>
            <NativeSelect
              value={field.type}
              onChange={(e) => {
                const type = e.target.value as FieldType;
                const keepMap = field.maps && (MAPS_FOR[type] ?? []).includes(field.maps);
                onChange({
                  ...field,
                  type,
                  maps: keepMap ? field.maps : undefined,
                  options: CHOICE_TYPES.includes(type)
                    ? field.options?.length
                      ? field.options
                      : [t('option', { n: 1 }), t('option', { n: 2 })]
                    : undefined
                });
              }}
            >
              {FIELD_TYPES.map((type) => (
                <NativeSelectOption key={type} value={type}>
                  {t(`types.${type}`)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Row>
          {CHOICE_TYPES.includes(field.type) && (
            <div className='sm:col-span-2'>
              <Row label={t('options')} hint={t('optionsHint')}>
                <Textarea
                  rows={4}
                  value={(field.options ?? []).join('\n')}
                  onChange={(e) =>
                    onChange({
                      ...field,
                      options: e.target.value
                        .split('\n')
                        .map((o) => o.slice(0, 80))
                        .slice(0, 30)
                    })
                  }
                />
              </Row>
            </div>
          )}
          {!NO_PLACEHOLDER.includes(field.type) && !CHOICE_TYPES.includes(field.type) && (
            <Row label={t('placeholder')}>
              <Input
                value={field.placeholder ?? ''}
                maxLength={160}
                onChange={(e) => onChange({ ...field, placeholder: e.target.value || undefined })}
              />
            </Row>
          )}
          {field.type === 'section' ? (
            <div className='sm:col-span-2'>
              <Row label={t('sectionText')}>
                <Textarea
                  rows={3}
                  maxLength={1000}
                  value={field.help ?? ''}
                  onChange={(e) => onChange({ ...field, help: e.target.value || undefined })}
                />
              </Row>
            </div>
          ) : (
            <Row label={t('help')}>
              <Input
                value={field.help ?? ''}
                maxLength={240}
                onChange={(e) => onChange({ ...field, help: e.target.value || undefined })}
              />
            </Row>
          )}
          {field.type === 'file' && (
            <>
              <Row label={t('accept')}>
                <NativeSelect
                  value={field.accept ?? 'any'}
                  onChange={(e) =>
                    onChange({ ...field, accept: e.target.value as FormField['accept'] })
                  }
                >
                  {(['image', 'document', 'any'] as const).map((a) => (
                    <NativeSelectOption key={a} value={a}>
                      {t(`acceptOptions.${a}`)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Row>
              <Row label={t('maxFiles')}>
                <NativeSelect
                  value={String(field.max_files ?? 1)}
                  onChange={(e) => onChange({ ...field, max_files: Number(e.target.value) })}
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <NativeSelectOption key={n} value={String(n)}>
                      {n}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Row>
            </>
          )}
          {field.type === 'rating' && (
            <Row label={t('stars')}>
              <NativeSelect
                value={String(field.max ?? 5)}
                onChange={(e) => onChange({ ...field, max: Number(e.target.value) })}
              >
                {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <NativeSelectOption key={n} value={String(n)}>
                    {n}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Row>
          )}
          {mapsAllowed.length > 0 && (
            <Row label={t('maps')} hint={t('mapsHint')}>
              <NativeSelect
                value={field.maps ?? ''}
                onChange={(e) =>
                  onChange({
                    ...field,
                    maps: (e.target.value || undefined) as FormField['maps']
                  })
                }
              >
                <NativeSelectOption value=''>{t('mapsNone')}</NativeSelectOption>
                {mapsAllowed.map((m) => (
                  <NativeSelectOption key={m} value={m}>
                    {t(`mapsTo.${m as FieldMap}`)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Row>
          )}
          <div
            className={cn(
              'flex flex-wrap items-center gap-x-6 gap-y-3 sm:col-span-2',
              field.type === 'section' && 'hidden'
            )}
          >
            <label className='flex items-center gap-2 text-sm'>
              <Switch
                checked={!!field.required}
                onCheckedChange={(v) => onChange({ ...field, required: v === true })}
              />
              {t('required')}
            </label>
            <label className='flex items-center gap-2 text-sm'>
              <Switch
                checked={field.width === 'half'}
                onCheckedChange={(v) => onChange({ ...field, width: v ? 'half' : undefined })}
              />
              {t('half')}
            </label>
          </div>
        </div>
      )}
    </li>
  );
}

/** Clean a form before saving: no empty texts, trimmed options, stable ids. */
const trim = (v?: string) => (v && v.trim() ? v.trim() : undefined);

function cleanInput(input: SiteFormInput): SiteFormInput {
  const settings = Object.fromEntries(
    Object.entries(input.settings).filter(([, v]) => v !== undefined && v !== '')
  ) as FormSettings;
  return {
    ...input,
    name: input.name.trim(),
    settings,
    fields: input.fields.map((f) => ({
      ...f,
      label: f.label.trim(),
      placeholder: trim(f.placeholder),
      help: trim(f.help),
      options: f.options?.map((o) => o.trim()).filter((o, i, all) => o && all.indexOf(o) === i)
    }))
  };
}

/** Builder of one form: fields, look, after sending, sharing, with a live preview. */
export function FormBuilder({
  initial,
  publicId,
  onClose,
  onSaved
}: {
  initial: SiteFormInput;
  publicId: string | null;
  onClose: () => void;
  onSaved: (id: string, publicId: string) => void;
}) {
  const t = useTranslations('siteForms.builder');
  const scope = useSiteScope();
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const [form, setForm] = useState<SiteFormInput>(initial);
  const [open, setOpen] = useState<string | null>(initial.fields[0]?.id ?? null);
  const [dirty, setDirty] = useState(false);
  const set = (patch: Partial<SiteFormInput>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };
  const setSettings = (patch: Partial<FormSettings>) =>
    set({ settings: { ...form.settings, ...patch } });

  const save = useMutation({
    mutationFn: (status: SiteFormInput['status']) =>
      saveForm(createClient(), scope.websiteId, cleanInput({ ...form, status })),
    onSuccess: (row, status) => {
      setForm((f) => ({ ...f, id: row.id, status }));
      setDirty(false);
      toast.success(status === 'published' ? t('published') : t('saved'));
      void qc.invalidateQueries({ queryKey: formKeys.all(scope.websiteId) });
      onSaved(row.id, row.public_id);
    },
    onError: (e) => toast.error(errorMessage(e, 'saveFailed'))
  });

  function addField(type: FieldType) {
    const label = t(`newLabel.${type}`);
    const id = fieldIdFrom(
      label,
      form.fields.map((f) => f.id)
    );
    const field: FormField = {
      id,
      type,
      label,
      ...(CHOICE_TYPES.includes(type)
        ? { options: [t('option', { n: 1 }), t('option', { n: 2 })] }
        : {}),
      ...(type === 'file' ? { accept: 'any' as const, max_files: 1 } : {}),
      ...(type === 'rating' ? { max: 5, required: true } : {})
    };
    set({ fields: [...form.fields, field] });
    setOpen(id);
  }

  const canEdit = scope.canEdit;
  const preview = (
    <div className='bg-muted/40 rounded-xl border p-3 sm:p-6'>
      <FormRenderer
        preview
        form={{
          name: form.name,
          fields: form.fields,
          settings: form.settings,
          site: { name: scope.website.name }
        }}
      />
    </div>
  );

  return (
    <div className='grid gap-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <Button variant='ghost' onClick={onClose} className='-ml-2'>
          <Icons.chevronLeft className='size-4' aria-hidden />
          {t('back')}
        </Button>
        <div className='flex items-center gap-2'>
          <Badge variant={form.status === 'published' ? 'default' : 'outline'}>
            {t(`status.${form.status}`)}
          </Badge>
          {dirty && <span className='text-muted-foreground text-xs'>{t('unsaved')}</span>}
        </div>
      </div>

      <div className='grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]'>
        <Tabs defaultValue='fields' className='min-w-0'>
          <TabsList className='w-full flex-wrap justify-start'>
            <TabsTrigger value='fields'>{t('tabs.fields')}</TabsTrigger>
            <TabsTrigger value='look'>{t('tabs.look')}</TabsTrigger>
            <TabsTrigger value='after'>{t('tabs.after')}</TabsTrigger>
            <TabsTrigger value='share'>{t('tabs.share')}</TabsTrigger>
            <TabsTrigger value='preview' className='lg:hidden'>
              {t('tabs.preview')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value='fields' className='mt-4 grid gap-4'>
            <div className='grid gap-4 sm:grid-cols-2'>
              <Row label={t('name')} hint={t('nameHint')}>
                <Input
                  value={form.name}
                  maxLength={120}
                  onChange={(e) => set({ name: e.target.value })}
                />
              </Row>
              <Row label={t('formType')} hint={t('formTypeHint')}>
                <NativeSelect
                  value={form.form_type}
                  onChange={(e) => set({ form_type: e.target.value })}
                >
                  {FORM_TYPES.map((ft) => (
                    <NativeSelectOption key={ft} value={ft}>
                      {t(`formTypes.${ft}`)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Row>
            </div>
            <ul className='grid gap-2'>
              {form.fields.map((f, i) => (
                <FieldEditor
                  key={f.id}
                  field={f}
                  index={i}
                  count={form.fields.length}
                  others={form.fields.filter((o) => o.id !== f.id)}
                  open={open === f.id}
                  onToggle={() => setOpen(open === f.id ? null : f.id)}
                  onChange={(next) =>
                    set({ fields: form.fields.map((o) => (o.id === f.id ? next : o)) })
                  }
                  onMove={(dir) => {
                    const fields = [...form.fields];
                    [fields[i], fields[i + dir]] = [fields[i + dir], fields[i]];
                    set({ fields });
                  }}
                  onRemove={() => set({ fields: form.fields.filter((o) => o.id !== f.id) })}
                />
              ))}
            </ul>
            {form.fields.length < 40 && (
              <div className='grid gap-2'>
                <span className='text-sm font-medium'>{t('addField')}</span>
                <div className='flex flex-wrap gap-2'>
                  {FIELD_TYPES.filter(
                    (type) =>
                      type !== 'file' || form.fields.filter((f) => f.type === 'file').length < 3
                  ).map((type) => (
                    <Button
                      key={type}
                      type='button'
                      variant='outline'
                      size='sm'
                      onClick={() => addField(type)}
                    >
                      <Icons.add className='size-3.5' aria-hidden />
                      {t(`types.${type}`)}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value='look' className='mt-4 grid gap-4 sm:grid-cols-2'>
            <div className='sm:col-span-2'>
              <Row label={t('title')}>
                <Input
                  value={form.settings.title ?? ''}
                  maxLength={120}
                  placeholder={form.name}
                  onChange={(e) => setSettings({ title: e.target.value || undefined })}
                />
              </Row>
            </div>
            <div className='sm:col-span-2'>
              <Row label={t('description')}>
                <Textarea
                  rows={3}
                  maxLength={600}
                  value={form.settings.description ?? ''}
                  onChange={(e) => setSettings({ description: e.target.value || undefined })}
                />
              </Row>
            </div>
            <Row label={t('submitLabel')}>
              <Input
                value={form.settings.submit_label ?? ''}
                maxLength={40}
                placeholder={t('submitDefault')}
                onChange={(e) => setSettings({ submit_label: e.target.value || undefined })}
              />
            </Row>
            <Row label={t('accent')}>
              <div className='flex items-center gap-2'>
                <input
                  type='color'
                  aria-label={t('accent')}
                  value={form.settings.accent ?? '#111827'}
                  onChange={(e) => setSettings({ accent: e.target.value })}
                  className='h-10 w-14 cursor-pointer rounded-md border bg-transparent p-1'
                />
                <Input
                  value={form.settings.accent ?? '#111827'}
                  maxLength={7}
                  onChange={(e) =>
                    /^#[0-9a-fA-F]{0,6}$/.test(e.target.value) &&
                    setSettings({ accent: e.target.value })
                  }
                  className='w-28 font-mono'
                />
              </div>
            </Row>
            <Row label={t('mode')}>
              <NativeSelect
                value={form.settings.mode ?? ''}
                onChange={(e) =>
                  setSettings({ mode: (e.target.value || undefined) as FormSettings['mode'] })
                }
              >
                <NativeSelectOption value=''>{t('modes.auto')}</NativeSelectOption>
                <NativeSelectOption value='light'>{t('modes.light')}</NativeSelectOption>
                <NativeSelectOption value='dark'>{t('modes.dark')}</NativeSelectOption>
              </NativeSelect>
            </Row>
            <Row label={t('radius')}>
              <NativeSelect
                value={form.settings.radius ?? 'md'}
                onChange={(e) => setSettings({ radius: e.target.value as FormSettings['radius'] })}
              >
                <NativeSelectOption value='none'>{t('radii.none')}</NativeSelectOption>
                <NativeSelectOption value='md'>{t('radii.md')}</NativeSelectOption>
                <NativeSelectOption value='lg'>{t('radii.lg')}</NativeSelectOption>
              </NativeSelect>
            </Row>
            <Row label={t('font')}>
              <NativeSelect
                value={form.settings.font ?? 'sans'}
                onChange={(e) => setSettings({ font: e.target.value as FormSettings['font'] })}
              >
                {(['sans', 'serif', 'mono'] as const).map((v) => (
                  <NativeSelectOption key={v} value={v}>
                    {t(`fonts.${v}`)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Row>
            <Row label={t('layout')}>
              <NativeSelect
                value={form.settings.layout ?? 'card'}
                onChange={(e) => setSettings({ layout: e.target.value as FormSettings['layout'] })}
              >
                {(['card', 'plain'] as const).map((v) => (
                  <NativeSelectOption key={v} value={v}>
                    {t(`layouts.${v}`)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Row>
            <Row label={t('width')}>
              <NativeSelect
                value={form.settings.width ?? 'normal'}
                onChange={(e) =>
                  setSettings({
                    width:
                      e.target.value === 'normal'
                        ? undefined
                        : (e.target.value as FormSettings['width'])
                  })
                }
              >
                {(['narrow', 'normal', 'wide'] as const).map((v) => (
                  <NativeSelectOption key={v} value={v}>
                    {t(`widths.${v}`)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Row>
            <Row label={t('buttonStyle')}>
              <NativeSelect
                value={form.settings.button ?? 'solid'}
                onChange={(e) => setSettings({ button: e.target.value as FormSettings['button'] })}
              >
                {(['solid', 'outline', 'pill'] as const).map((v) => (
                  <NativeSelectOption key={v} value={v}>
                    {t(`buttons.${v}`)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Row>
            <div className='sm:col-span-2'>
              <Row label={t('cover')} hint={t('coverHint')}>
                <Input
                  type='url'
                  inputMode='url'
                  placeholder='https://'
                  maxLength={1000}
                  value={form.settings.cover_url ?? ''}
                  onChange={(e) => setSettings({ cover_url: e.target.value || undefined })}
                />
              </Row>
            </div>
            <label className='flex items-center gap-2 self-end text-sm'>
              <Switch
                checked={form.settings.show_logo !== false}
                onCheckedChange={(v) => setSettings({ show_logo: v === true })}
              />
              {t('showLogo')}
            </label>
          </TabsContent>

          <TabsContent value='after' className='mt-4 grid gap-4'>
            <Row label={t('successTitle')}>
              <Input
                value={form.settings.success_title ?? ''}
                maxLength={120}
                placeholder={t('successTitleDefault')}
                onChange={(e) => setSettings({ success_title: e.target.value || undefined })}
              />
            </Row>
            <Row label={t('successMessage')}>
              <Textarea
                rows={3}
                maxLength={600}
                placeholder={t('successMessageDefault')}
                value={form.settings.success_message ?? ''}
                onChange={(e) => setSettings({ success_message: e.target.value || undefined })}
              />
            </Row>
            <Row label={t('redirect')} hint={t('redirectHint')}>
              <Input
                type='url'
                inputMode='url'
                placeholder='https://'
                maxLength={500}
                value={form.settings.redirect_url ?? ''}
                onChange={(e) => setSettings({ redirect_url: e.target.value || undefined })}
              />
            </Row>
            <Row label={t('consent')} hint={t('consentHint')}>
              <Textarea
                rows={2}
                maxLength={300}
                value={form.settings.consent_text ?? ''}
                onChange={(e) => setSettings({ consent_text: e.target.value || undefined })}
              />
            </Row>
          </TabsContent>

          <TabsContent value='share' className='mt-4'>
            <ShareForm
              publicId={publicId}
              published={form.status === 'published' && !dirty}
              origins={form.settings.embed_origins}
              onOrigins={(embed_origins) => setSettings({ embed_origins })}
              canEdit={canEdit}
            />
          </TabsContent>

          <TabsContent value='preview' className='mt-4 lg:hidden'>
            {preview}
          </TabsContent>
        </Tabs>

        <div className='hidden lg:block'>
          <div className='sticky top-20 grid gap-2'>
            <span className='text-muted-foreground text-xs font-medium'>{t('livePreview')}</span>
            {preview}
          </div>
        </div>
      </div>

      {canEdit ? (
        <div className='bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border'>
          <Button
            variant='outline'
            className='h-11 flex-1 sm:h-9 sm:flex-none'
            disabled={save.isPending}
            onClick={() => save.mutate('draft')}
          >
            {form.status === 'published' ? t('unpublish') : t('saveDraft')}
          </Button>
          <Button
            className='h-11 flex-1 sm:h-9 sm:flex-none'
            disabled={save.isPending || !form.name.trim() || form.fields.length === 0}
            onClick={() => save.mutate('published')}
          >
            {save.isPending && <Icons.spinner className='size-4 animate-spin' aria-hidden />}
            {form.status === 'published' ? t('saveLive') : t('publish')}
          </Button>
        </div>
      ) : (
        <p className='text-muted-foreground text-sm'>{t('readOnly')}</p>
      )}
    </div>
  );
}

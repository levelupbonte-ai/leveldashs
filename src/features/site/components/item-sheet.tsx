'use client';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator
} from '@/components/ui/field';
import { LoadingButton } from '@/components/ui/loading-button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet';
import { useAppForm } from '@/lib/form';
import { useTranslations } from 'next-intl';
import { Fragment, useMemo } from 'react';
import { toast } from 'sonner';
import type { ContentRow } from '../api/types';
import { useSiteMutations } from '../api/mutations';
import type { CollectionDef, FieldDef } from '../config/collections';
import { ImageInput } from './image-input';
import { ImagesInput } from './images-input';
import { useFieldMessages } from '@/lib/validation/use-fields';
import { buildSchema, toFormValues, toRow, type FormValues } from './item-form-schema';
import { useCollectionText } from './use-collection-text';
import { useSiteScope } from './use-site-scope';

export function ItemSheet({
  def,
  item,
  open,
  onOpenChange
}: {
  def: CollectionDef;
  item: ContentRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const text = useCollectionText(def);
  const t = useTranslations('site.content');
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className='w-full overflow-y-auto sm:max-w-lg'>
        <SheetHeader>
          <SheetTitle>
            {item
              ? t('editTitle', {
                  name: text.display(
                    def.fields.find((f) => f.name === def.titleField),
                    item[def.titleField]
                  )
                })
              : text.addTitle}
          </SheetTitle>
          <SheetDescription>{text.description}</SheetDescription>
        </SheetHeader>
        {/* key resets the form when switching between items */}
        <ItemForm
          key={item?.id ?? 'new'}
          def={def}
          item={item}
          onDone={() => onOpenChange(false)}
        />
      </SheetContent>
    </Sheet>
  );
}

function ItemForm({
  def,
  item,
  onDone
}: {
  def: CollectionDef;
  item: ContentRow | null;
  onDone: () => void;
}) {
  const scope = useSiteScope();
  const { saveItem, uploadMedia } = useSiteMutations(scope);
  const text = useCollectionText(def);
  const t = useTranslations('site.content');
  const tv = useTranslations('site.validation');
  const shared = useFieldMessages();
  const schema = useMemo(
    () =>
      buildSchema(def, {
        https: tv('https'),
        number: tv('number'),
        amount: tv('amount'),
        required: tv('required'),
        date: tv('date'),
        tooLong: tv('tooLong'),
        noHtml: shared.noHtml,
        choice: shared.choice,
        email: shared.email,
        phone: shared.phone
      }),
    [def, tv, shared]
  );

  const form = useAppForm({
    defaultValues: toFormValues(def, item),
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      try {
        // The cleaned values (the schema output), not the raw input.
        const clean = schema.parse(value) as FormValues;
        await saveItem.mutateAsync({ def, id: item?.id, values: toRow(def, clean) });
        toast.success(item ? t('saved') : t('added'));
        onDone();
      } catch {
        // the mutation already shows an error toast
      }
    }
  });

  const upload = async (file: File) => (await uploadMedia.mutateAsync({ file })).url;

  const renderField = (f: FieldDef) => {
    const common = {
      label: text.fieldLabel(f),
      description: text.fieldHint(f),
      required: f.required
    };
    switch (f.kind) {
      case 'textarea':
        return (
          <form.AppField
            key={f.name}
            name={f.name}
            children={(field) => (
              <field.TextareaField
                {...common}
                rows={f.max && f.max > 4000 ? 10 : 4}
                maxLength={f.max}
              />
            )}
          />
        );
      case 'number':
      case 'money':
        return (
          <form.AppField
            key={f.name}
            name={f.name}
            children={(field) => (
              <field.TextField
                {...common}
                type='number'
                min={0}
                step={f.kind === 'money' ? '0.01' : '1'}
              />
            )}
          />
        );
      case 'switch':
        return (
          <form.AppField
            key={f.name}
            name={f.name}
            children={(field) => <field.SwitchField {...common} />}
          />
        );
      case 'tags':
        return (
          <form.AppField
            key={f.name}
            name={f.name}
            children={(field) => (
              <field.TagsField
                {...common}
                placeholder={t('tagsPlaceholder')}
                maxLength={f.max ?? 80}
                maxItems={f.maxItems ?? 30}
              />
            )}
          />
        );
      case 'select':
        return (
          <form.AppField
            key={f.name}
            name={f.name}
            children={(field) => (
              <field.SelectField {...common} placeholder={t('choose')} options={text.options(f)} />
            )}
          />
        );
      case 'date':
        return (
          <form.AppField
            key={f.name}
            name={f.name}
            children={(field) => <field.TextField {...common} type='date' />}
          />
        );
      case 'images':
        return (
          <form.Field
            key={f.name}
            name={f.name}
            children={(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor={field.name}>{text.fieldLabel(f)}</FieldLabel>
                  <ImagesInput
                    id={field.name}
                    value={Array.isArray(field.state.value) ? (field.state.value as string[]) : []}
                    onChange={(v) => field.handleChange(v)}
                    onUpload={upload}
                    invalid={invalid}
                  />
                  <FieldDescription>{text.fieldHint(f) ?? t('imageHint')}</FieldDescription>
                  {invalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          />
        );
      case 'image':
        return (
          <form.Field
            key={f.name}
            name={f.name}
            children={(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor={field.name}>
                    {text.fieldLabel(f)}
                    {f.required && ' *'}
                  </FieldLabel>
                  <ImageInput
                    id={field.name}
                    value={String(field.state.value ?? '')}
                    onChange={(v) => field.handleChange(v)}
                    onUpload={upload}
                    invalid={invalid}
                  />
                  <FieldDescription>
                    {text.fieldHint(f) ? `${text.fieldHint(f)} ` : ''}
                    {t('imageHint')}
                  </FieldDescription>
                  {invalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          />
        );
      default:
        return (
          <form.AppField
            key={f.name}
            name={f.name}
            children={(field) =>
              f.kind === 'url' ? (
                <field.TextField {...common} inputMode='url' maxLength={2048} showCount={false} />
              ) : (
                <field.TextField {...common} maxLength={f.max} />
              )
            }
          />
        );
    }
  };

  return (
    <form
      className='flex flex-1 flex-col gap-4 px-4'
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
    >
      {def.liveHint && (
        <p className='bg-muted/60 text-muted-foreground flex items-start gap-2 rounded-md border px-3 py-2 text-sm'>
          <Icons.info className='mt-0.5 size-4 shrink-0' aria-hidden='true' />
          {t('liveHint')}
        </p>
      )}
      <FieldGroup>
        {def.fields.map((f, i) =>
          f.group ? (
            <Fragment key={`group-${f.name}`}>
              {i > 0 && <FieldSeparator />}
              <h3 className='text-base font-semibold'>{text.groupTitle(f.group)}</h3>
              {renderField(f)}
            </Fragment>
          ) : (
            renderField(f)
          )
        )}
      </FieldGroup>
      <SheetFooter className='px-0'>
        <form.Subscribe
          selector={(s) => s.isSubmitting}
          children={(submitting) => (
            <LoadingButton type='submit' loading={submitting} disabled={!scope.canEdit}>
              {t('save')}
            </LoadingButton>
          )}
        />
        <Button type='button' variant='outline' onClick={onDone}>
          {t('cancel')}
        </Button>
      </SheetFooter>
    </form>
  );
}

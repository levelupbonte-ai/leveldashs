'use client';

import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
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
import { useMemo } from 'react';
import { toast } from 'sonner';
import type { ContentRow } from '../api/types';
import { useSiteMutations } from '../api/mutations';
import type { CollectionDef, FieldDef } from '../config/collections';
import { ImageInput } from './image-input';
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
            {item ? t('editTitle', { name: String(item[def.titleField] ?? '') }) : text.addTitle}
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
  const schema = useMemo(
    () =>
      buildSchema(def, {
        https: tv('https'),
        number: tv('number'),
        amount: tv('amount'),
        required: tv('required'),
        date: tv('date'),
        tooLong: tv('tooLong')
      }),
    [def, tv]
  );

  const form = useAppForm({
    defaultValues: toFormValues(def, item),
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      try {
        await saveItem.mutateAsync({ def, id: item?.id, values: toRow(def, value as FormValues) });
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
            children={(field) => <field.TagsField {...common} placeholder={t('tagsPlaceholder')} />}
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
                  <FieldDescription>{t('imageHint')}</FieldDescription>
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
            children={(field) => <field.TextField {...common} maxLength={f.max} />}
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
      <FieldGroup>{def.fields.map(renderField)}</FieldGroup>
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

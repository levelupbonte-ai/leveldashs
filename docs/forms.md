# Forms

Forms follow the **official shadcn TanStack Form conventions**, scaled with
TanStack's own [`createFormHook`](https://tanstack.com/form/latest/docs/framework/react/guides/form-composition)
pattern: the doc's `Field` anatomy is written **once per widget** as a reusable
field component, and pages use them as one-liners inside `form.AppField`.

- [shadcn: TanStack Form](https://ui.shadcn.com/docs/forms/tanstack) — the
  anatomy inside every field component
- [TanStack Form docs](https://tanstack.com/form/latest) — validators,
  listeners, arrays, async validation

## Architecture

| File | What it provides |
| --- | --- |
| `src/lib/form-context.ts` | `createFormHookContexts` — `fieldContext`, `formContext`, `useFieldContext`, `useFieldInvalid`, `BaseFieldProps` |
| `src/components/forms/fields/*.tsx` | 16 field components, each the exact shadcn doc anatomy for its widget |
| `src/components/forms/submit-button.tsx` | `SubmitButton` — disables while submitting (`form.Subscribe`) |
| `src/lib/form.ts` | `createFormHook` — exports `useAppForm` / `withForm` with everything registered |

## The pattern

One `useAppForm` per form, a Zod schema validated on submit, and one
`form.AppField` per field rendering the matching component:

```tsx
'use client';

import { useAppForm } from '@/lib/form';
import { FieldGroup } from '@/components/ui/field';
import * as z from 'zod';

const formSchema = z.object({
  title: z.string().min(5, 'Title must be at least 5 characters.'),
  severity: z.string().min(1, 'Select a severity.')
});

export function BugReportForm() {
  const form = useAppForm({
    defaultValues: { title: '', severity: '' },
    validators: { onSubmit: formSchema },
    onSubmit: ({ value }) => console.log(value)
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
    >
      <FieldGroup>
        <form.AppField
          name='title'
          children={(field) => (
            <field.TextField label='Bug Title' required placeholder='Login button broken' />
          )}
        />
        <form.AppField
          name='severity'
          children={(field) => (
            <field.SelectField
              label='Severity'
              options={[
                { value: 'low', label: 'Low' },
                { value: 'high', label: 'High' }
              ]}
            />
          )}
        />
        <form.AppForm>
          <form.SubmitButton>Submit</form.SubmitButton>
        </form.AppForm>
      </FieldGroup>
    </form>
  );
}
```

`form.AppField`'s `name` is fully typed against `defaultValues` — typos are
compile errors. Field-level validators/listeners go on the `form.AppField`
element (async checks, `onChangeListenTo` linked fields).

## Available field components

All render inside `form.AppField` as `field.XxxField`; every one takes
`label`, `description?`, `required?`.

| Component | Value type | Notes |
| --- | --- | --- |
| `TextField` | `string` / `number` | Any input `type` (text, email, password, tel, url, time, number). Number inputs convert at the edge — clearing writes `undefined`. Shows a spinner while async validators run. With `maxLength`, free text shows the character counter (`showCount={false}` hides it) |
| `TextareaField` | `string` | With `maxLength`, shows the character counter (`showCount={false}` hides it) |
| `SelectField` | `string` | `options` array |
| `CheckboxField` | `boolean` | Single checkbox (terms, consent) |
| `SwitchField` | `boolean` | Label/description left, switch right |
| `RadioGroupField` | `string` | `FieldSet` + `FieldLegend` semantics |
| `SliderField` | `number` | `min`/`max`/`step` + value readout |
| `ComboboxField` | `string` | Searchable select (Popover + Command) |
| `DatePickerField` | `Date \| undefined` | Popover + Calendar, `disabledDates` |
| `DateRangeField` | `DateRange \| undefined` | Two-month range calendar |
| `OtpField` | `string` | 6-digit code (3 + 3) |
| `ColorField` | `string` | Native picker + hex input |
| `FileUploadField` | `File[]` | Wraps `FileUploader`, `maxSize`/`maxFiles` |
| `CheckboxGroupField` | `string[]` | Needs `mode='array'` on the AppField |
| `TagsField` | `string[]` | Needs `mode='array'`; Enter/Add pushes, badges remove; `maxLength` per tag, `maxItems` (with an item counter) |
| `ToggleGroupField` | `string[]` | Needs `mode='array'`; pass `ToggleGroupItem`s as children |

## One-off custom fields — drop down to `form.Field`

For anything the components don't cover (object-row arrays, bespoke UI), use
the raw doc pattern directly — it composes freely with the components:

```tsx
<form.Field
  name='members'
  mode='array'
  children={(field) => (
    <>
      {field.state.value.map((_, i) => (
        <form.Field
          name={`members[${i}].name`}
          children={(subField) => {
            const isInvalid = subField.state.meta.isTouched && !subField.state.meta.isValid;
            return (
              <Field data-invalid={isInvalid}>
                <Input
                  value={subField.state.value}
                  onChange={(e) => subField.handleChange(e.target.value)}
                  onBlur={subField.handleBlur}
                  aria-invalid={isInvalid}
                />
                {isInvalid && <FieldError errors={subField.state.meta.errors} />}
              </Field>
            );
          }}
        />
      ))}
      <Button type='button' onClick={() => field.pushValue({ name: '' })}>Add</Button>
    </>
  )}
/>
```

The doc conventions inside any custom field: `data-invalid` on `<Field>`,
`aria-invalid` on the control, `{isInvalid && <FieldError errors={…} />}`,
function validators return `{ message: '…' }` objects.

## Scaling to large forms — `withForm` sections

Split a big form into reusable section components with `withForm` (also
exported from `@/lib/form`). Sections receive the form instance as a prop and
keep **fully typed field names** — a typo'd `name` inside a section is still a
compile error:

```tsx
import { useAppForm, withForm } from '@/lib/form';

const ShippingSection = withForm({
  defaultValues: checkoutDefaults, // ties the section to the form's shape
  render: function ShippingRender({ form }) {
    return (
      <FieldGroup>
        <form.AppField
          name='shipping.street'
          children={(field) => <field.TextField label='Street' required />}
        />
        <form.AppField
          name='shipping.city'
          children={(field) => <field.TextField label='City' required />}
        />
      </FieldGroup>
    );
  }
});

// In the page:
const form = useAppForm({ defaultValues: checkoutDefaults, ... });
<ShippingSection form={form} />
```

Deep paths (`org.billing.address.city`), array sub-paths
(`admins[0].prefs.notify`), and union-typed leaves all stay typed, and
typechecking stays fast at 40+ fields.

## Template-specific notes

**Submitting with React Query.** `onSubmit` awaits the mutation; success/error
handling lives on the mutation (see `features/products/components/product-form.tsx`):

```tsx
onSubmit: async ({ value }) => {
  await createMutation.mutateAsync(value);
};
```

**Sheet / Dialog forms.** The submit button lives in the footer, outside the
`<form>` element, connected via the HTML `form` attribute
(`features/users/components/user-form-sheet.tsx`):

```tsx
<form id='user-form-sheet' onSubmit={…}>…</form>
<SheetFooter>
  <Button type='submit' form='user-form-sheet'>Save</Button>
</SheetFooter>
```

**Multi-step forms.** `useFormStepper(stepSchemas, { fullSchema })` from
`@/hooks/use-stepper` gates step navigation: `Next` validates the current
step's schema and paints its errors; the final submit re-validates the whole
schema and never submits invalid data. Route every submit through the gate —
see `features/forms/components/multi-step-product-form.tsx`.

**Number inputs.** `TextField type='number'` already converts at the edge;
give required numbers a human message: `z.number({ error: 'Price is required' })`.

**Caveats to know** (verified by stress testing):

- `field.XxxField` components assert their value type via
  `useFieldContext<T>()` — the compiler checks the `name` path exists, but
  not that the widget matches the path's value type (a `SwitchField` on a
  string path compiles and renders wrong values). Match widgets to the table
  above.
- Rendering a field component outside `form.AppField` throws a clear error
  (`fieldContext only works when within a fieldComponent…`) — it cannot fail
  silently.
- Two forms with identical field names mounted at once (a sheet over a page)
  produce duplicate `id` attributes — the shadcn doc's `id={field.name}`
  convention. Form *state* stays fully isolated; only label-target ids
  collide. Rename fields or avoid simultaneous mounting if labels must stay
  clickable in both.
- Forgetting `mode='array'` on an AppField using `CheckboxGroupField` /
  `TagsField` / `ToggleGroupField` still renders and updates — but keep the
  convention: array mode gives TanStack correct per-item meta tracking.

## Examples in the dashboard

| Page | Route | Demonstrates |
| --- | --- | --- |
| Basic Form | `/dashboard/forms/basic` | All 16 field components incl. array-mode groups, pickers, OTP, tags, upload |
| Advanced | `/dashboard/forms/advanced` | Async validation, linked fields (`onChangeListenTo`), nested paths, raw `form.Field` object-row arrays, listener side effects |
| Multi-Step | `/dashboard/forms/multi-step` | Per-step schemas, validation gate, review step |
| Sheet Form | `/dashboard/forms/sheet-form` | Sheet + Dialog forms with external submit buttons |

## Character limits and counters

Every free-text field has a maximum length, set in three places that agree:

1. the Zod schema (`f.text(max)`, `.max(max, { message: tv('maxLength', { max }) })`),
   with the translated `validation.maxLength` message;
2. `maxLength={max}` on the field, which also turns on the shared counter
   (`src/components/forms/char-counter.tsx`): “42 / 160”, muted, **amber** from
   90 % of the limit (or the last 10 characters of long fields), **red** past it
   (a value saved before the limit existed), linked to the input with
   `aria-describedby` and read as “42 of 160 characters used”;
3. the database (CHECK on the column, or `private.check_text` in the writing
   function). The UI limit is never larger than the database's.

The counter shows on `text` / `search` inputs and every textarea. Formatted
inputs (email, URL, phone, codes, currencies, amounts) only get `maxLength`
(`showCount={false}` on a text input that holds a code). Raw inputs outside
`useAppForm` (staff notes, media alt text, chat composer, assistant prompt)
render `<CharCounter>` themselves; the chat composer and the assistant show it
only near the limit.

| Field | Limit | Where the database checks it |
| --- | --- | --- |
| SEO title / description | 60 / 160 (DB 70 / 320) | `website_settings_seo_len_check` |
| SEO keywords | 20 × 60 | same (count) |
| Collections (services, team, gallery, reviews, FAQ, announcements, showcase) | `max` / `maxItems` per field in `features/site/config/collections.ts` | column CHECKs (`*_check`, `*_len_check`) |
| Full name (profile, sign-up, onboarding), signer name / title | 120 | `profiles.full_name` CHECK, `signer_name` / `signer_title` CHECKs |
| Organization / website name | 120 | `organizations_name_check`, `websites_name_check` |
| Access request: business / website / phone / message | 120 / 200 / 40 / 1000 | `access_requests_*_check` |
| Staff notes (forms inbox, bookings, project requests) | 4000 | `*_staff_notes_len_check`, `project_requests_text_len_check` |
| Media alt text | 500 | `media_alt_text_check` |
| Chat message / assistant prompt | 4000 | chat functions / `POST /api/assistant` |
| Plan upgrade message | 1000 | `plan_upgrade_requests_message_check` |
| Contract order form (project, package, plan / schedule / scope / notes) | 120 / 120 / 120 / 500 / 4000 / 1000 | `contracts_order_form_check` (20 KB) |
| Contract template title / body, void reason | 200 / 200 000, 500 | `contract_templates_*_check`, `contracts_void_reason_check` |
| Billing: charge label / description, payment note, plan name / description, discount label, issuer fields, billing note | 120 / 1000, 120, 60 / 500, 60, 200 / 500 / 80, 1000 | `billing_charges_*`, `plans_*`, `discounts_label_check`, `billing_issuers_*`, `organization_billing_billing_note_check` |
| Server key / passkey name | 80 / 120 | `site_api_keys_name_check` / Supabase Auth (passkey factor) |
| Searches | 100 | (not stored) |


/** A field of a LevelUp form (validated again by the database on save and on submit). */
export const FIELD_TYPES = [
  'text',
  'email',
  'phone',
  'textarea',
  'select',
  'radio',
  'checkbox',
  'multiselect',
  'date',
  'number'
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** Standard columns of a request a field can fill (shown in the Requests inbox). */
export const FIELD_MAPS = ['name', 'email', 'phone', 'company', 'message'] as const;
export type FieldMap = (typeof FIELD_MAPS)[number];

export interface FormField {
  id: string;
  type: FieldType;
  label: string;
  placeholder?: string;
  help?: string;
  required?: boolean;
  maps?: FieldMap;
  options?: string[];
  width?: 'half';
}

export interface FormSettings {
  title?: string;
  description?: string;
  submit_label?: string;
  success_title?: string;
  success_message?: string;
  consent_text?: string;
  /** https only; the visitor goes there after sending. */
  redirect_url?: string;
  accent?: string;
  mode?: 'light' | 'dark';
  radius?: 'none' | 'md' | 'lg';
  show_logo?: boolean;
}

export const FORM_TYPES = ['contact', 'quote', 'registration', 'newsletter', 'survey'] as const;
export type FormType = (typeof FORM_TYPES)[number];

export type FormStatus = 'draft' | 'published';

/** public.site_forms_list row. */
export interface SiteForm {
  id: string;
  public_id: string;
  website_id: string;
  name: string;
  form_type: string;
  status: FormStatus;
  fields: FormField[];
  settings: FormSettings;
  updated_at: string;
  answers: number;
  last_answer_at: string | null;
}

export interface SiteFormInput {
  id: string | null;
  name: string;
  form_type: string;
  status: FormStatus;
  fields: FormField[];
  settings: FormSettings;
}

/** public.public_form_get: what the hosted page shows. */
export interface PublicForm {
  public_id: string;
  name: string;
  fields: FormField[];
  settings: FormSettings;
  site: { name?: string; domain?: string; logo_url?: string };
}

export type FormValues = Record<string, string | string[] | boolean | number | undefined>;

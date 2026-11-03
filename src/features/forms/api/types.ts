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
  'time',
  'number',
  'url',
  'rating',
  'file',
  'section'
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
  /** file: what may be sent (images only, documents only, or both). */
  accept?: 'image' | 'document' | 'any';
  /** file: 1 to 5 files. */
  max_files?: number;
  /** rating: 3 to 10 stars. */
  max?: number;
}

/** A file picked in a file field, once uploaded (the path is private). */
export interface UploadedValue {
  path: string;
  name: string;
  preview: string | null;
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
  /** https image shown above the form. */
  cover_url?: string;
  font?: 'sans' | 'serif' | 'mono';
  layout?: 'card' | 'plain';
  width?: 'narrow' | 'wide';
  button?: 'solid' | 'outline' | 'pill';
}

export const FORM_TYPES = [
  'contact',
  'quote',
  'registration',
  'newsletter',
  'survey',
  'application',
  'feedback',
  'order'
] as const;
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

export type FormValues = Record<
  string,
  string | string[] | boolean | number | UploadedValue[] | undefined
>;

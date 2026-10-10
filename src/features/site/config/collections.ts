// Content collections a client manages from the dashboard. Each one maps to a
// tenant table (organization_id + website_id, RLS editor write) and is shown
// only when the website has the matching feature enabled.

export type FieldKind =
  | 'text'
  | 'textarea'
  | 'number'
  | 'money'
  | 'select'
  | 'switch'
  | 'tags'
  | 'image'
  | 'date'
  | 'url';

// Labels live in the messages: `site.collections.<key>.fields.<name>` (label) and
// `site.collections.<key>.hints.<name>` (when `hint` is set). See docs/i18n.md.
export interface FieldDef {
  name: string;
  kind: FieldKind;
  required?: boolean;
  max?: number;
  /** Has a help text (`site.collections.<key>.hints.<name>`). */
  hint?: boolean;
  /** Select values; `label` is shown as is (otherwise `site.status.<value>`). */
  options?: { value: string; label?: string }[];
}

export interface CollectionDef {
  key: CollectionKey;
  table: string;
  /** website_features key(s); undefined = always available */
  feature?: string | string[];
  titleField: string;
  subtitleField?: string;
  imageField?: string;
  /** Generate a unique `slug` column from this field */
  slugFrom?: string;
  orderBy: { column: string; ascending: boolean };
  fields: FieldDef[];
}

export const STATUS_VALUES = ['published', 'draft', 'archived'] as const;

const status: FieldDef = {
  name: 'status',
  kind: 'select',
  options: STATUS_VALUES.map((value) => ({ value }))
};
const sortOrder: FieldDef = { name: 'sort_order', kind: 'number', hint: true };

export const COLLECTIONS = {
  services: {
    key: 'services',
    table: 'services',
    feature: 'services',
    titleField: 'name',
    subtitleField: 'price_label',
    imageField: 'image_url',
    slugFrom: 'name',
    orderBy: { column: 'sort_order', ascending: true },
    fields: [
      { name: 'name', kind: 'text', required: true, max: 160 },
      { name: 'category', kind: 'text', max: 80 },
      { name: 'description', kind: 'textarea', max: 2000 },
      {
        name: 'price_cents',
        kind: 'money',
        hint: true
      },
      {
        name: 'price_label',
        kind: 'text',
        max: 40,
        hint: true
      },
      { name: 'duration_minutes', kind: 'number' },
      { name: 'badge', kind: 'text', max: 40 },
      { name: 'featured', kind: 'switch' },
      { name: 'inclusions', kind: 'tags' },
      { name: 'image_url', kind: 'image' },
      sortOrder,
      status
    ]
  },
  team: {
    key: 'team',
    table: 'team_members',
    feature: 'team',
    titleField: 'name',
    subtitleField: 'role',
    imageField: 'image_url',
    slugFrom: 'name',
    orderBy: { column: 'sort_order', ascending: true },
    fields: [
      { name: 'name', kind: 'text', required: true, max: 120 },
      { name: 'role', kind: 'text', max: 120 },
      { name: 'bio', kind: 'textarea', max: 4000 },
      { name: 'phone', kind: 'text', max: 40 },
      { name: 'email', kind: 'text', max: 254 },
      { name: 'tags', kind: 'tags' },
      { name: 'image_url', kind: 'image' },
      sortOrder,
      status
    ]
  },
  gallery: {
    key: 'gallery',
    table: 'gallery_items',
    feature: 'gallery',
    titleField: 'title',
    subtitleField: 'category',
    imageField: 'image_url',
    orderBy: { column: 'sort_order', ascending: true },
    fields: [
      { name: 'image_url', kind: 'image', required: true },
      { name: 'title', kind: 'text', required: true, max: 200 },
      { name: 'description', kind: 'textarea', max: 2000 },
      { name: 'category', kind: 'text', max: 80 },
      { name: 'tags', kind: 'tags' },
      sortOrder,
      status
    ]
  },
  reviews: {
    key: 'reviews',
    table: 'reviews',
    feature: 'reviews',
    titleField: 'author',
    subtitleField: 'comment',
    orderBy: { column: 'sort_order', ascending: true },
    fields: [
      { name: 'author', kind: 'text', required: true, max: 120 },
      {
        name: 'rating',
        kind: 'select',
        options: ['5', '4', '3', '2', '1'].map((v) => ({ value: v, label: `${v} / 5` }))
      },
      { name: 'comment', kind: 'textarea', required: true, max: 4000 },
      { name: 'review_date', kind: 'date' },
      { name: 'source', kind: 'text', max: 60, hint: true },
      sortOrder,
      status
    ]
  },
  faq: {
    key: 'faq',
    table: 'faq_items',
    titleField: 'question',
    subtitleField: 'category',
    orderBy: { column: 'sort_order', ascending: true },
    fields: [
      { name: 'question', kind: 'text', required: true, max: 500 },
      { name: 'answer', kind: 'textarea', required: true, max: 8000 },
      { name: 'category', kind: 'text', max: 80 },
      sortOrder,
      status
    ]
  },
  announcements: {
    key: 'announcements',
    table: 'announcements',
    feature: ['announcements', 'promotions', 'blog'],
    titleField: 'title',
    subtitleField: 'status',
    imageField: 'image_url',
    slugFrom: 'title',
    orderBy: { column: 'created_at', ascending: false },
    fields: [
      { name: 'title', kind: 'text', required: true, max: 200 },
      { name: 'content', kind: 'textarea', max: 20000 },
      { name: 'image_url', kind: 'image' },
      { name: 'published_at', kind: 'date' },
      { name: 'expires_at', kind: 'date' },
      status
    ]
  }
} satisfies Record<string, Omit<CollectionDef, 'key'> & { key: string }>;

export type CollectionKey = keyof typeof COLLECTIONS;

export function getCollection(key: string): CollectionDef | null {
  return Object.hasOwn(COLLECTIONS, key)
    ? (COLLECTIONS[key as CollectionKey] as CollectionDef)
    : null;
}

export function featureEnabled(feature: string | string[] | undefined, enabled: string[]) {
  if (!feature) return true;
  const keys = Array.isArray(feature) ? feature : [feature];
  return keys.some((k) => enabled.includes(k));
}

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
  | 'url'
  | 'images';

// Labels live in the messages: `site.collections.<key>.fields.<name>` (label) and
// `site.collections.<key>.hints.<name>` (when `hint` is set). See docs/i18n.md.
export interface FieldDef {
  name: string;
  kind: FieldKind;
  required?: boolean;
  /** Maximum characters (text, textarea; each tag of a `tags` field). Never above the column's CHECK. */
  max?: number;
  /** Maximum number of tags (default 30). Never above the column's CHECK. */
  maxItems?: number;
  /** Has a help text (`site.collections.<key>.hints.<name>`). */
  hint?: boolean;
  /** Select values; `label` is shown as is (otherwise `site.status.<value>`). */
  options?: { value: string; label?: string }[];
  /** Option labels come from `site.fieldOptions.<optionsKey>.<value>`. */
  optionsKey?: string;
  /** Value of a new item (select / switch). */
  defaultValue?: string | boolean;
  /** Starts a titled group of fields in the form (`site.fieldGroups.<group>`). */
  group?: string;
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
  /** Sort by this column first (e.g. the page of a page section). */
  groupBy?: string;
  /** Move up / down buttons that rewrite `sort_order` (within `groupBy`). */
  reorder?: boolean;
  /** Select / switch fields shown as badges on each card. */
  badges?: string[];
  /** Shows "changes appear on the site within a few seconds". */
  liveHint?: boolean;
  fields: FieldDef[];
}

export const STATUS_VALUES = ['published', 'draft', 'archived'] as const;

const status: FieldDef = {
  name: 'status',
  kind: 'select',
  options: STATUS_VALUES.map((value) => ({ value }))
};
const sortOrder: FieldDef = { name: 'sort_order', kind: 'number', hint: true };

// ---------------------------------------------------------------- showcase CMS
// The LevelUp showcase site (feature `showcase_cms`, docs/showcase-cms.md).

export const SHOWCASE_STATUS = ['published', 'draft', 'hidden'] as const;
export const SHOWCASE_LAYOUTS = ['spotlight', 'card', 'band', 'split-left', 'split-right'] as const;
export const SHOWCASE_ANIMATIONS = ['rise', 'clip', 'tilt', 'parallax', 'none'] as const;
export const SHOWCASE_ACCENTS = [
  'auto',
  'home',
  'services',
  'projects',
  'studio',
  'pricing',
  'about',
  'faq',
  'contact',
  'legal'
] as const;
export const SHOWCASE_PAGES = [
  'home',
  'projects',
  'services',
  'studio',
  'about',
  'pricing',
  'faq',
  'contact'
] as const;
/** Section keys of each page (the showcase renders these, in the order of the rows). */
export const SHOWCASE_SECTION_KEYS = [
  'hero',
  'capabilities',
  'how-it-works',
  'work',
  'templates',
  'ecosystem',
  'pricing',
  'cta',
  'header',
  'list',
  'next',
  'concepts',
  'booking',
  'security',
  'care',
  'creators',
  'how',
  'features',
  'questions',
  'story',
  'how-we-build',
  'plans',
  'comparison',
  'faq',
  'reviews',
  'contact'
] as const;

const options = (values: readonly string[]) => values.map((value) => ({ value }));
const showcaseStatus: FieldDef = {
  name: 'status',
  kind: 'select',
  options: options(SHOWCASE_STATUS),
  defaultValue: 'draft',
  hint: true,
  group: 'display'
};
const showcaseDisplay: FieldDef[] = [
  {
    name: 'layout',
    kind: 'select',
    optionsKey: 'layout',
    options: options(SHOWCASE_LAYOUTS),
    defaultValue: 'spotlight',
    hint: true
  },
  {
    name: 'animation',
    kind: 'select',
    optionsKey: 'animation',
    options: options(SHOWCASE_ANIMATIONS),
    defaultValue: 'tilt',
    hint: true
  },
  {
    name: 'accent',
    kind: 'select',
    optionsKey: 'accent',
    options: options(SHOWCASE_ACCENTS),
    defaultValue: 'auto',
    hint: true
  },
  sortOrder
];

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
  },
  templates: {
    key: 'templates',
    table: 'showcase_templates',
    feature: 'showcase_cms',
    titleField: 'name',
    subtitleField: 'category_en',
    imageField: 'desktop_image',
    slugFrom: 'name',
    orderBy: { column: 'sort_order', ascending: true },
    reorder: true,
    badges: ['layout', 'animation', 'featured_on_home'],
    liveHint: true,
    fields: [
      { name: 'name', kind: 'text', required: true, max: 160, group: 'general' },
      { name: 'url', kind: 'url', required: true, hint: true },
      { name: 'domain', kind: 'text', max: 200, hint: true },
      { name: 'category_en', kind: 'text', max: 120, group: 'english' },
      { name: 'tagline_en', kind: 'text', max: 200 },
      { name: 'description_en', kind: 'textarea', max: 2000 },
      { name: 'features_en', kind: 'tags', max: 200, maxItems: 12, hint: true },
      { name: 'category_fr', kind: 'text', max: 120, group: 'french' },
      { name: 'tagline_fr', kind: 'text', max: 200 },
      { name: 'description_fr', kind: 'textarea', max: 2000 },
      { name: 'features_fr', kind: 'tags', max: 200, maxItems: 12, hint: true },
      { name: 'desktop_image', kind: 'image', required: true, hint: true, group: 'images' },
      { name: 'mobile_image', kind: 'image', hint: true },
      showcaseStatus,
      { name: 'featured_on_home', kind: 'switch', defaultValue: true, hint: true },
      ...showcaseDisplay
    ]
  },
  'case-studies': {
    key: 'case-studies',
    table: 'showcase_projects',
    feature: 'showcase_cms',
    titleField: 'name',
    subtitleField: 'label_en',
    imageField: 'desktop_image',
    slugFrom: 'name',
    orderBy: { column: 'sort_order', ascending: true },
    reorder: true,
    badges: ['layout', 'animation', 'featured_on_home'],
    liveHint: true,
    fields: [
      { name: 'name', kind: 'text', required: true, max: 160, group: 'general' },
      { name: 'url', kind: 'text', required: true, max: 2048, hint: true },
      { name: 'domain', kind: 'text', max: 200, hint: true },
      { name: 'year', kind: 'text', max: 20 },
      { name: 'case_study', kind: 'switch', defaultValue: true, hint: true },
      { name: 'label_en', kind: 'text', max: 160, hint: true, group: 'english' },
      { name: 'summary_en', kind: 'textarea', max: 2000 },
      { name: 'industry_en', kind: 'text', max: 160 },
      { name: 'location_en', kind: 'text', max: 160 },
      { name: 'project_status_en', kind: 'text', max: 80, hint: true },
      { name: 'scope_en', kind: 'text', max: 300 },
      { name: 'what_we_built_en', kind: 'tags', max: 200, maxItems: 20 },
      { name: 'tags_en', kind: 'tags', max: 200, maxItems: 12, hint: true },
      { name: 'steps_en', kind: 'textarea', max: 4000, hint: true },
      { name: 'label_fr', kind: 'text', max: 160, group: 'french' },
      { name: 'summary_fr', kind: 'textarea', max: 2000 },
      { name: 'industry_fr', kind: 'text', max: 160 },
      { name: 'location_fr', kind: 'text', max: 160 },
      { name: 'project_status_fr', kind: 'text', max: 80 },
      { name: 'scope_fr', kind: 'text', max: 300 },
      { name: 'what_we_built_fr', kind: 'tags', max: 200, maxItems: 20 },
      { name: 'tags_fr', kind: 'tags', max: 200, maxItems: 12 },
      { name: 'steps_fr', kind: 'textarea', max: 4000 },
      { name: 'card_title', kind: 'text', max: 200, hint: true, group: 'card' },
      { name: 'card_badge_en', kind: 'text', max: 200 },
      { name: 'card_description_en', kind: 'textarea', max: 2000 },
      { name: 'card_cta_en', kind: 'text', max: 120 },
      { name: 'card_badge_fr', kind: 'text', max: 200 },
      { name: 'card_description_fr', kind: 'textarea', max: 2000 },
      { name: 'card_cta_fr', kind: 'text', max: 120 },
      { name: 'desktop_image', kind: 'image', required: true, hint: true, group: 'images' },
      { name: 'mobile_image', kind: 'image', hint: true },
      { name: 'cover_image', kind: 'image', hint: true },
      { name: 'gallery_images', kind: 'images', hint: true },
      { name: 'image_alt_en', kind: 'text', max: 300 },
      { name: 'image_alt_fr', kind: 'text', max: 300 },
      { name: 'mobile_alt_en', kind: 'text', max: 300 },
      { name: 'mobile_alt_fr', kind: 'text', max: 300 },
      { name: 'gallery_captions_en', kind: 'tags', max: 200, maxItems: 12, hint: true },
      { name: 'gallery_captions_fr', kind: 'tags', max: 200, maxItems: 12 },
      showcaseStatus,
      { name: 'featured_on_home', kind: 'switch', defaultValue: false, hint: true },
      ...showcaseDisplay
    ]
  },
  'page-sections': {
    key: 'page-sections',
    table: 'showcase_sections',
    feature: 'showcase_cms',
    titleField: 'section_key',
    subtitleField: 'page',
    orderBy: { column: 'sort_order', ascending: true },
    groupBy: 'page',
    reorder: true,
    badges: ['animation'],
    liveHint: true,
    fields: [
      {
        name: 'page',
        kind: 'select',
        required: true,
        optionsKey: 'page',
        options: options(SHOWCASE_PAGES),
        group: 'general'
      },
      {
        name: 'section_key',
        kind: 'select',
        required: true,
        optionsKey: 'section',
        options: options(SHOWCASE_SECTION_KEYS),
        hint: true
      },
      { name: 'enabled', kind: 'switch', defaultValue: true, hint: true },
      { name: 'eyebrow_en', kind: 'text', max: 200, hint: true, group: 'english' },
      { name: 'title_en', kind: 'textarea', max: 300, hint: true },
      { name: 'body_en', kind: 'textarea', max: 2000 },
      { name: 'eyebrow_fr', kind: 'text', max: 200, group: 'french' },
      { name: 'title_fr', kind: 'textarea', max: 300 },
      { name: 'body_fr', kind: 'textarea', max: 2000 },
      {
        name: 'animation',
        kind: 'select',
        optionsKey: 'sectionAnimation',
        options: options(['auto', ...SHOWCASE_ANIMATIONS]),
        defaultValue: 'auto',
        hint: true,
        group: 'display'
      },
      sortOrder
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

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

export interface FieldDef {
  name: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  max?: number;
  description?: string;
  options?: { value: string; label: string }[];
}

export interface CollectionDef {
  key: CollectionKey;
  table: string;
  /** website_features key(s); undefined = always available */
  feature?: string | string[];
  title: string;
  description: string;
  singular: string;
  titleField: string;
  subtitleField?: string;
  imageField?: string;
  /** Generate a unique `slug` column from this field */
  slugFrom?: string;
  orderBy: { column: string; ascending: boolean };
  fields: FieldDef[];
}

export const STATUS_OPTIONS = [
  { value: 'published', label: 'Publié' },
  { value: 'draft', label: 'Brouillon' },
  { value: 'archived', label: 'Archivé' }
];

const status: FieldDef = {
  name: 'status',
  label: 'Statut',
  kind: 'select',
  options: STATUS_OPTIONS
};
const sortOrder: FieldDef = {
  name: 'sort_order',
  label: 'Ordre d’affichage',
  kind: 'number',
  description: 'Les plus petits nombres apparaissent en premier.'
};

export const COLLECTIONS = {
  services: {
    key: 'services',
    table: 'services',
    feature: 'services',
    title: 'Services',
    description: 'Vos prestations, prix et durées affichés sur le site.',
    singular: 'service',
    titleField: 'name',
    subtitleField: 'price_label',
    imageField: 'image_url',
    slugFrom: 'name',
    orderBy: { column: 'sort_order', ascending: true },
    fields: [
      { name: 'name', label: 'Nom', kind: 'text', required: true, max: 160 },
      { name: 'category', label: 'Catégorie', kind: 'text', max: 80 },
      { name: 'description', label: 'Description', kind: 'textarea', max: 2000 },
      {
        name: 'price_cents',
        label: 'Prix',
        kind: 'money',
        description: 'Utilisé pour les réservations.'
      },
      {
        name: 'price_label',
        label: 'Prix affiché',
        kind: 'text',
        max: 40,
        description: 'Ex. « À partir de 35 $ ».'
      },
      { name: 'duration_minutes', label: 'Durée (minutes)', kind: 'number' },
      { name: 'badge', label: 'Badge', kind: 'text', max: 40 },
      { name: 'featured', label: 'Mis en avant', kind: 'switch' },
      { name: 'inclusions', label: 'Inclus', kind: 'tags' },
      { name: 'image_url', label: 'Image', kind: 'image' },
      sortOrder,
      status
    ]
  },
  team: {
    key: 'team',
    table: 'team_members',
    feature: 'team',
    title: 'Équipe',
    description: 'Les membres de votre équipe présentés sur le site.',
    singular: 'membre',
    titleField: 'name',
    subtitleField: 'role',
    imageField: 'image_url',
    slugFrom: 'name',
    orderBy: { column: 'sort_order', ascending: true },
    fields: [
      { name: 'name', label: 'Nom', kind: 'text', required: true, max: 120 },
      { name: 'role', label: 'Rôle', kind: 'text', max: 120 },
      { name: 'bio', label: 'Présentation', kind: 'textarea', max: 4000 },
      { name: 'phone', label: 'Téléphone', kind: 'text', max: 40 },
      { name: 'email', label: 'E-mail', kind: 'text', max: 254 },
      { name: 'tags', label: 'Spécialités', kind: 'tags' },
      { name: 'image_url', label: 'Photo', kind: 'image' },
      sortOrder,
      status
    ]
  },
  gallery: {
    key: 'gallery',
    table: 'gallery_items',
    feature: 'gallery',
    title: 'Galerie',
    description: 'Les photos de votre galerie.',
    singular: 'photo',
    titleField: 'title',
    subtitleField: 'category',
    imageField: 'image_url',
    orderBy: { column: 'sort_order', ascending: true },
    fields: [
      { name: 'image_url', label: 'Image', kind: 'image', required: true },
      { name: 'title', label: 'Titre', kind: 'text', required: true, max: 200 },
      { name: 'description', label: 'Description', kind: 'textarea', max: 2000 },
      { name: 'category', label: 'Catégorie', kind: 'text', max: 80 },
      { name: 'tags', label: 'Mots-clés', kind: 'tags' },
      sortOrder,
      status
    ]
  },
  reviews: {
    key: 'reviews',
    table: 'reviews',
    feature: 'reviews',
    title: 'Avis clients',
    description: 'Les témoignages affichés sur votre site.',
    singular: 'avis',
    titleField: 'author',
    subtitleField: 'comment',
    orderBy: { column: 'sort_order', ascending: true },
    fields: [
      { name: 'author', label: 'Auteur', kind: 'text', required: true, max: 120 },
      {
        name: 'rating',
        label: 'Note',
        kind: 'select',
        options: ['5', '4', '3', '2', '1'].map((v) => ({ value: v, label: `${v} / 5` }))
      },
      { name: 'comment', label: 'Commentaire', kind: 'textarea', required: true, max: 4000 },
      { name: 'review_date', label: 'Date', kind: 'date' },
      { name: 'source', label: 'Source', kind: 'text', max: 60, description: 'Ex. Google, Yelp.' },
      sortOrder,
      status
    ]
  },
  faq: {
    key: 'faq',
    table: 'faq_items',
    title: 'FAQ',
    description: 'Questions fréquentes.',
    singular: 'question',
    titleField: 'question',
    subtitleField: 'category',
    orderBy: { column: 'sort_order', ascending: true },
    fields: [
      { name: 'question', label: 'Question', kind: 'text', required: true, max: 500 },
      { name: 'answer', label: 'Réponse', kind: 'textarea', required: true, max: 8000 },
      { name: 'category', label: 'Catégorie', kind: 'text', max: 80 },
      sortOrder,
      status
    ]
  },
  announcements: {
    key: 'announcements',
    table: 'announcements',
    feature: ['announcements', 'promotions', 'blog'],
    title: 'Annonces',
    description: 'Actualités, promotions et articles.',
    singular: 'annonce',
    titleField: 'title',
    subtitleField: 'status',
    imageField: 'image_url',
    slugFrom: 'title',
    orderBy: { column: 'created_at', ascending: false },
    fields: [
      { name: 'title', label: 'Titre', kind: 'text', required: true, max: 200 },
      { name: 'content', label: 'Contenu', kind: 'textarea', max: 20000 },
      { name: 'image_url', label: 'Image', kind: 'image' },
      { name: 'published_at', label: 'Publié le', kind: 'date' },
      { name: 'expires_at', label: 'Expire le', kind: 'date' },
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

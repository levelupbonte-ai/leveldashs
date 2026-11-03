import type { FormField, FormSettings, FormType } from '../api/types';

/** Ready-made forms the client starts from (then edits every field). Labels come from messages. */
export interface Starter {
  key:
    | 'contact'
    | 'quote'
    | 'booking'
    | 'event'
    | 'job'
    | 'feedback'
    | 'photos'
    | 'order'
    | 'survey'
    | 'blank';
  formType: FormType;
  fields: (t: (key: string) => string) => FormField[];
  settings: (t: (key: string) => string) => FormSettings;
}

const list = (value: string) =>
  value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

const nameEmail = (t: (key: string) => string): FormField[] => [
  { id: 'name', type: 'text', label: t('name'), required: true, maps: 'name', width: 'half' },
  { id: 'email', type: 'email', label: t('email'), required: true, maps: 'email', width: 'half' }
];

export const STARTERS: Starter[] = [
  {
    key: 'contact',
    formType: 'contact',
    fields: (t) => [
      ...nameEmail(t),
      { id: 'phone', type: 'phone', label: t('phone'), maps: 'phone' },
      { id: 'message', type: 'textarea', label: t('message'), required: true, maps: 'message' }
    ],
    settings: (t) => ({ title: t('contactTitle'), submit_label: t('send') })
  },
  {
    key: 'quote',
    formType: 'quote',
    fields: (t) => [
      ...nameEmail(t),
      { id: 'company', type: 'text', label: t('company'), maps: 'company' },
      {
        id: 'budget',
        type: 'select',
        label: t('budget'),
        options: [t('budget1'), t('budget2'), t('budget3')]
      },
      { id: 'message', type: 'textarea', label: t('project'), required: true, maps: 'message' }
    ],
    settings: (t) => ({ title: t('quoteTitle'), submit_label: t('requestQuote') })
  },
  {
    key: 'booking',
    formType: 'contact',
    fields: (t) => [
      ...nameEmail(t),
      { id: 'phone', type: 'phone', label: t('phone'), required: true, maps: 'phone' },
      { id: 'preferred_date', type: 'date', label: t('date'), required: true, width: 'half' },
      {
        id: 'time_of_day',
        type: 'radio',
        label: t('time'),
        options: [t('morning'), t('afternoon'), t('evening')],
        width: 'half'
      },
      { id: 'message', type: 'textarea', label: t('notes'), maps: 'message' }
    ],
    settings: (t) => ({ title: t('bookingTitle'), submit_label: t('requestBooking') })
  },
  {
    key: 'event',
    formType: 'registration',
    fields: (t) => [
      ...nameEmail(t),
      { id: 'phone', type: 'phone', label: t('phone'), maps: 'phone', width: 'half' },
      { id: 'guests', type: 'number', label: t('guests'), required: true, width: 'half' },
      { id: 'event_date', type: 'date', label: t('eventDate'), width: 'half' },
      { id: 'diet', type: 'text', label: t('diet'), width: 'half' },
      { id: 'message', type: 'textarea', label: t('notes'), maps: 'message' }
    ],
    settings: (t) => ({ title: t('eventTitle'), submit_label: t('register') })
  },
  {
    key: 'job',
    formType: 'application',
    fields: (t) => [
      { id: 'about', type: 'section', label: t('personal'), help: t('personalText') },
      ...nameEmail(t),
      { id: 'phone', type: 'phone', label: t('phone'), required: true, maps: 'phone' },
      {
        id: 'position',
        type: 'select',
        label: t('position'),
        required: true,
        options: list(t('positions')),
        width: 'half'
      },
      { id: 'experience', type: 'number', label: t('experience'), width: 'half' },
      { id: 'cv', type: 'file', label: t('cv'), required: true, accept: 'document', max_files: 1 },
      { id: 'portfolio', type: 'url', label: t('portfolio') },
      { id: 'message', type: 'textarea', label: t('why'), maps: 'message' }
    ],
    settings: (t) => ({ title: t('jobTitle'), submit_label: t('apply') })
  },
  {
    key: 'feedback',
    formType: 'feedback',
    fields: (t) => [
      { id: 'rating', type: 'rating', label: t('rating'), required: true, max: 5 },
      { id: 'liked', type: 'textarea', label: t('liked') },
      { id: 'improve', type: 'textarea', label: t('improve') },
      {
        id: 'recommend',
        type: 'radio',
        label: t('recommend'),
        options: [t('yes'), t('maybe'), t('no')]
      },
      { id: 'name', type: 'text', label: t('name'), maps: 'name', width: 'half' },
      { id: 'email', type: 'email', label: t('email'), maps: 'email', width: 'half' }
    ],
    settings: (t) => ({ title: t('feedbackTitle'), submit_label: t('sendFeedback') })
  },
  {
    key: 'photos',
    formType: 'quote',
    fields: (t) => [
      ...nameEmail(t),
      { id: 'phone', type: 'phone', label: t('phone'), maps: 'phone' },
      {
        id: 'photos',
        type: 'file',
        label: t('photosLabel'),
        required: true,
        accept: 'image',
        max_files: 5
      },
      { id: 'message', type: 'textarea', label: t('describe'), required: true, maps: 'message' }
    ],
    settings: (t) => ({ title: t('photosTitle'), submit_label: t('sendRequest') })
  },
  {
    key: 'order',
    formType: 'order',
    fields: (t) => [
      { id: 'you', type: 'section', label: t('personal'), help: t('personalText') },
      ...nameEmail(t),
      { id: 'phone', type: 'phone', label: t('phone'), required: true, maps: 'phone' },
      { id: 'order', type: 'section', label: t('details'), help: t('detailsText') },
      {
        id: 'products',
        type: 'multiselect',
        label: t('products'),
        required: true,
        options: list(t('productList'))
      },
      { id: 'quantity', type: 'number', label: t('quantity'), required: true, width: 'half' },
      {
        id: 'delivery',
        type: 'radio',
        label: t('delivery'),
        required: true,
        options: list(t('deliveryOptions')),
        width: 'half'
      },
      { id: 'address', type: 'textarea', label: t('address') },
      { id: 'preferred_date', type: 'date', label: t('date'), width: 'half' },
      { id: 'preferred_time', type: 'time', label: t('preferredTime'), width: 'half' }
    ],
    settings: (t) => ({ title: t('orderTitle'), submit_label: t('order') })
  },
  {
    key: 'survey',
    formType: 'survey',
    fields: (t) => [
      {
        id: 'source',
        type: 'radio',
        label: t('q1'),
        required: true,
        options: list(t('q1options'))
      },
      { id: 'priorities', type: 'multiselect', label: t('q2'), options: list(t('q2options')) },
      { id: 'rating', type: 'rating', label: t('rating'), max: 5 },
      { id: 'comments', type: 'textarea', label: t('q3') },
      { id: 'email', type: 'email', label: t('email'), maps: 'email' }
    ],
    settings: (t) => ({ title: t('surveyTitle'), submit_label: t('sendAnswers') })
  },
  {
    key: 'blank',
    formType: 'contact',
    fields: (t) => nameEmail(t),
    settings: () => ({})
  }
];

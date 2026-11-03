import type { FormField, FormSettings, FormType } from '../api/types';

/** Ready-made forms the client starts from (then edits every field). Labels come from messages. */
export interface Starter {
  key: 'contact' | 'quote' | 'booking' | 'blank';
  formType: FormType;
  fields: (t: (key: string) => string) => FormField[];
  settings: (t: (key: string) => string) => FormSettings;
}

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
    key: 'blank',
    formType: 'contact',
    fields: (t) => nameEmail(t),
    settings: () => ({})
  }
];

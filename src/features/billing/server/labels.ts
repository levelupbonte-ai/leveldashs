import 'server-only';
import { getFormatter } from 'next-intl/server';
import { minorToMajor, moneyFormat } from '@/features/payments/lib/money';
import { timeZone } from '@/i18n/config';
import { getTranslatorFor } from '@/i18n/messages';
import type { ChargeDocument, ChargeDocumentKind } from '../api/types';
import type { ChargePdfLabels } from './pdf';

const KEYS = [
  'invoice',
  'receipt',
  'number',
  'invoiceRef',
  'issueDate',
  'dueDate',
  'noDueDate',
  'billTo',
  'from',
  'taxId',
  'description',
  'amount',
  'subtotal',
  'discount',
  'total',
  'balanceDue',
  'amountPaid',
  'paymentDate',
  'paymentMethod',
  'reference'
] as const;

/** Invoice / receipt wording in the reader's language (`emails.billingDocument`). */
export async function chargePdfLabels(
  locale: unknown,
  doc: ChargeDocument,
  kind: ChargeDocumentKind
): Promise<ChargePdfLabels & { fileWord: string }> {
  const { locale: resolved, t } = await getTranslatorFor(locale);
  const format = await getFormatter({ locale: resolved });
  const k = (key: string, values?: Record<string, string | number>) =>
    t(`emails.billingDocument.${key}` as 'emails.billingDocument.invoice', values);
  const c = doc.charge;
  const day = (iso: string) =>
    format.dateTime(new Date(`${iso}T12:00:00Z`), { dateStyle: 'long', timeZone: 'UTC' });
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'long', timeZone });
  const base = Object.fromEntries(KEYS.map((key) => [key, k(key)])) as Record<
    (typeof KEYS)[number],
    string
  >;
  const status = kind === 'receipt' ? 'paid' : c.status;
  return {
    ...base,
    currencyNote: k('currencyNote', { currency: c.currency.toUpperCase() }),
    taxIdLine: (value) => k('taxIdLine', { value }),
    voidNotice: k('voidNotice'),
    paidNotice: c.paid_at ? k('paidNotice', { date: date(c.paid_at) }) : '',
    dueNotice:
      status === 'due' || status === 'overdue'
        ? c.due_date
          ? k('dueNotice', { date: day(c.due_date) })
          : k('dueNoticeNoDate')
        : '',
    receiptNotice: k('receiptNotice', { number: c.invoice_number }),
    draftNotice: k('draftNotice'),
    questions: doc.issuer.email ? k('questions', { email: doc.issuer.email }) : '',
    status: (s) => k(`status.${s}`),
    receiptStatus: k('receiptStatus'),
    method: (m) => k(`method.${m}`),
    kind: (value) => k(`kind.${value}`),
    page: (current, total) => k('page', { current, total }),
    money: (amount, currency) =>
      format.number(minorToMajor(amount, currency), moneyFormat(currency)),
    day,
    date,
    fileWord: k(kind === 'invoice' ? 'fileInvoice' : 'fileReceipt')
  };
}

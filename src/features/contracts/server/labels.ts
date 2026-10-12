import 'server-only';
import { getFormatter } from 'next-intl/server';
import { getTranslatorFor } from '@/i18n/messages';
import type { ContractPdfLabels } from './pdf';

/** PDF wording in the reader's language (`emails.contract.pdf` messages). */
export async function contractPdfLabels(locale: unknown): Promise<ContractPdfLabels> {
  const { locale: resolved, t } = await getTranslatorFor(locale);
  const format = await getFormatter({ locale: resolved });
  const k = (key: string) => t(`emails.contract.pdf.${key}` as 'emails.contract.pdf.brand');
  const keys = [
    'brand',
    'signedCopy',
    'unsignedCopy',
    'client',
    'contractId',
    'version',
    'orderForm',
    'orderFormEmpty',
    'project',
    'package',
    'buildPrice',
    'paymentSchedule',
    'monthlyPlan',
    'monthlyPrice',
    'startDate',
    'scope',
    'notes',
    'agreement',
    'translation',
    'translationNotice',
    'certificate',
    'certificateIntro',
    'signer',
    'signerTitle',
    'email',
    'signedAt',
    'sentAt',
    'ip',
    'userAgent',
    'consent',
    'consentText',
    'hash',
    'hashNote',
    'drawnSignature',
    'typedSignature'
  ] as const;
  const labels = Object.fromEntries(keys.map((key) => [key, k(key)])) as Record<
    (typeof keys)[number],
    string
  >;
  return {
    ...labels,
    page: (current, total) => t('emails.contract.pdf.page', { current, total }),
    money: (amount) => format.number(amount, { style: 'currency', currency: 'USD' }),
    date: (isoDate) =>
      format.dateTime(new Date(`${isoDate}T12:00:00Z`), { dateStyle: 'long', timeZone: 'UTC' })
  };
}

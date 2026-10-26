import { PDFDocument, PDFFont, PDFPage, StandardFonts, degrees, rgb } from 'pdf-lib';
import type { ChargeDocument, ChargeDocumentKind, ChargeStatus, PaymentMethod } from '../api/types';

/**
 * Invoice and receipt PDFs (pdf-lib, standard fonts, no external assets — same
 * approach as the contract PDF). Everything shown comes from
 * public.billing_charge_document; amounts are the database's, never recomputed.
 */

export interface ChargePdfLabels {
  invoice: string;
  receipt: string;
  number: string;
  invoiceRef: string;
  issueDate: string;
  dueDate: string;
  noDueDate: string;
  billTo: string;
  from: string;
  taxId: string;
  taxIdLine: (value: string) => string;
  description: string;
  amount: string;
  subtotal: string;
  discount: string;
  total: string;
  balanceDue: string;
  amountPaid: string;
  paymentDate: string;
  paymentMethod: string;
  reference: string;
  currencyNote: string;
  voidNotice: string;
  paidNotice: string;
  dueNotice: string;
  receiptNotice: string;
  draftNotice: string;
  questions: string;
  status: (status: ChargeStatus) => string;
  /** "Paid" on a receipt (its own key: the word agrees with "receipt" in French). */
  receiptStatus: string;
  method: (method: PaymentMethod) => string;
  kind: (kind: string) => string;
  page: (current: number, total: number) => string;
  money: (amount: number, currency: string) => string;
  /** YYYY-MM-DD */
  day: (isoDate: string) => string;
  /** timestamptz, shown in the clients' time zone */
  date: (iso: string) => string;
}

const PAGE = { width: 612, height: 792 }; // US Letter, like the contract PDF
const M = 56;
const INK = rgb(0.09, 0.09, 0.11);
const MUTED = rgb(0.42, 0.43, 0.47);
const RULE = rgb(0.87, 0.87, 0.89);
const FILL = rgb(0.96, 0.96, 0.97);
const STATUS_COLOR: Record<ChargeStatus, ReturnType<typeof rgb>> = {
  paid: rgb(0.09, 0.5, 0.29),
  due: rgb(0.16, 0.32, 0.75),
  overdue: rgb(0.75, 0.16, 0.16),
  void: rgb(0.45, 0.45, 0.48)
};

// Standard fonts only cover WinAnsi: map what Intl and people commonly produce.
const REPLACEMENTS: Record<string, string> = {
  ' ': ' ', // narrow no-break space (French number groups)
  ' ': ' ',
  ' ': ' ',
  '‑': '-',
  '−': '-',
  '→': '->'
};

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

class Canvas {
  readonly page: PDFPage;
  readonly fonts: Fonts;
  private charsets = new Map<PDFFont, Set<number>>();

  constructor(page: PDFPage, fonts: Fonts) {
    this.page = page;
    this.fonts = fonts;
  }

  clean(text: string, font: PDFFont): string {
    let set = this.charsets.get(font);
    if (!set) {
      set = new Set(font.getCharacterSet());
      this.charsets.set(font, set);
    }
    let out = '';
    for (const ch of text.replace(/[\t\r\n]+/g, ' ')) {
      if (set.has(ch.codePointAt(0)!)) out += ch;
      else out += REPLACEMENTS[ch] ?? '?';
    }
    return out;
  }

  width(text: string, size: number, font = this.fonts.regular) {
    return font.widthOfTextAtSize(this.clean(text, font), size);
  }

  text(
    text: string,
    x: number,
    y: number,
    opts: { size?: number; bold?: boolean; color?: typeof INK; align?: 'left' | 'right' } = {}
  ) {
    const font = opts.bold ? this.fonts.bold : this.fonts.regular;
    const size = opts.size ?? 10;
    const value = this.clean(text, font);
    const dx = opts.align === 'right' ? font.widthOfTextAtSize(value, size) : 0;
    this.page.drawText(value, { x: x - dx, y, size, font, color: opts.color ?? INK });
  }

  /** Word-wrapped lines of at most `max` points. */
  wrap(text: string, size: number, max: number, bold = false): string[] {
    const font = bold ? this.fonts.bold : this.fonts.regular;
    const lines: string[] = [];
    for (const paragraph of text.split(/\r?\n/)) {
      let line = '';
      for (const word of this.clean(paragraph, font).split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) <= max || !line) line = next;
        else {
          lines.push(line);
          line = word;
        }
      }
      if (line) lines.push(line);
    }
    return lines;
  }

  rule(y: number, x1 = M, x2 = PAGE.width - M, color = RULE, thickness = 0.7) {
    this.page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color });
  }
}

export async function buildChargePdf(
  doc: ChargeDocument,
  kind: ChargeDocumentKind,
  labels: ChargePdfLabels
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const c = doc.charge;
  const title = kind === 'invoice' ? labels.invoice : labels.receipt;
  pdf.setTitle(`${title} ${c.invoice_number}`);
  pdf.setSubject(`${title} ${c.invoice_number} · ${doc.organization.name}`);
  pdf.setAuthor(doc.issuer.legal_name ?? '');
  pdf.setCreator('LevelUp');
  pdf.setProducer('LevelUp');
  pdf.setCreationDate(new Date(c.created_at));

  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold)
  };
  const w = new Canvas(pdf.addPage([PAGE.width, PAGE.height]), fonts);
  const right = PAGE.width - M;
  const status: ChargeStatus = kind === 'receipt' ? 'paid' : c.status;
  let y = PAGE.height - M;

  // Draft strip (staff preview before the business details are complete).
  if (!doc.issuer_ready) {
    w.page.drawRectangle({
      x: 0,
      y: PAGE.height - 26,
      width: PAGE.width,
      height: 26,
      color: rgb(1, 0.95, 0.8)
    });
    w.text(labels.draftNotice, M, PAGE.height - 17, {
      size: 9,
      bold: true,
      color: rgb(0.55, 0.36, 0.02)
    });
    y -= 14;
  }

  // ---- header: issuer (left), document title, number and status (right)
  const top = y;
  w.text(doc.issuer.legal_name || '—', M, y - 14, { size: 15, bold: true });
  let ly = y - 32;
  const issuerLines = [
    ...(doc.issuer.address ? w.wrap(doc.issuer.address, 9.5, 260) : []),
    ...(doc.issuer.email ? [doc.issuer.email] : []),
    ...(doc.issuer.tax_id ? [labels.taxIdLine(doc.issuer.tax_id)] : [])
  ];
  for (const line of issuerLines) {
    w.text(line, M, ly, { size: 9.5, color: MUTED });
    ly -= 13;
  }

  w.text(title.toUpperCase(), right, top - 20, { size: 22, bold: true, align: 'right' });
  w.text(c.invoice_number, right, top - 38, { size: 11, align: 'right', color: MUTED });
  const pill = (kind === 'receipt' ? labels.receiptStatus : labels.status(status)).toUpperCase();
  const pillW = w.width(pill, 8.5, fonts.bold) + 16;
  w.page.drawRectangle({
    x: right - pillW,
    y: top - 62,
    width: pillW,
    height: 16,
    color: STATUS_COLOR[status],
    opacity: 0.12,
    borderColor: STATUS_COLOR[status],
    borderOpacity: 0.5,
    borderWidth: 0.6
  });
  w.text(pill, right - 8, top - 57, {
    size: 8.5,
    bold: true,
    align: 'right',
    color: STATUS_COLOR[status]
  });

  y = Math.min(ly, top - 70) - 14;
  w.rule(y);
  y -= 26;

  // ---- bill to (left), document facts (right)
  w.text(labels.billTo.toUpperCase(), M, y, { size: 8, bold: true, color: MUTED });
  const nameLines = w.wrap(doc.organization.name, 12, 250, true);
  nameLines.forEach((line, i) => w.text(line, M, y - 17 - i * 15, { size: 12, bold: true }));

  const facts: [string, string][] =
    kind === 'invoice'
      ? [
          [labels.number, c.invoice_number],
          [labels.issueDate, labels.day(c.issued_on)],
          [labels.dueDate, c.due_date ? labels.day(c.due_date) : labels.noDueDate]
        ]
      : [
          [labels.invoiceRef, c.invoice_number],
          [labels.paymentDate, c.paid_at ? labels.date(c.paid_at) : '—'],
          [labels.paymentMethod, c.payment_method ? labels.method(c.payment_method) : '—'],
          ...(c.payment_reference
            ? ([[labels.reference, c.payment_reference]] as [string, string][])
            : [])
        ];
  const labelX = right - 230;
  facts.forEach(([k, v], i) => {
    const fy = y - i * 16;
    w.text(k, labelX, fy, { size: 9, color: MUTED });
    const value = w.wrap(v, 9.5, 140, true)[0] ?? '';
    w.text(value, right, fy, { size: 9.5, bold: true, align: 'right' });
  });
  y -= Math.max(17 + nameLines.length * 15, facts.length * 16) + 22;

  // ---- line table
  const amountX = right - 10;
  w.page.drawRectangle({ x: M, y: y - 8, width: right - M, height: 22, color: FILL });
  w.text(labels.description.toUpperCase(), M + 10, y, { size: 8, bold: true, color: MUTED });
  w.text(labels.amount.toUpperCase(), amountX, y, {
    size: 8,
    bold: true,
    color: MUTED,
    align: 'right'
  });
  y -= 30;
  const descLines = w.wrap(c.label, 10.5, 330, true);
  descLines.forEach((line, i) => w.text(line, M + 10, y - i * 14, { size: 10.5, bold: true }));
  w.text(labels.money(c.base_amount, c.currency), amountX, y, { size: 10.5, align: 'right' });
  y -= descLines.length * 14;
  const sub = [labels.kind(c.kind), c.description].filter(Boolean).join(' · ');
  for (const line of w.wrap(sub, 9, 330).slice(0, 6)) {
    w.text(line, M + 10, y, { size: 9, color: MUTED });
    y -= 12;
  }
  y -= 10;
  w.rule(y);
  y -= 22;

  // ---- totals
  const totalsX = right - 230;
  const row = (
    label: string,
    value: string,
    opts: { bold?: boolean; size?: number; color?: typeof INK } = {}
  ) => {
    w.text(label, totalsX, y, {
      size: opts.size ?? 9.5,
      bold: opts.bold,
      color: opts.color ?? MUTED
    });
    w.text(value, amountX, y, {
      size: opts.size ?? 9.5,
      bold: opts.bold,
      align: 'right',
      color: opts.color ?? INK
    });
    y -= (opts.size ?? 9.5) + 8;
  };
  if (c.discount_amount > 0) {
    row(labels.subtotal, labels.money(c.base_amount, c.currency));
    row(
      `${labels.discount}${c.discount_label ? ` (${c.discount_label})` : ''}`,
      `-${labels.money(c.discount_amount, c.currency)}`
    );
  }
  w.rule(y + 6, totalsX, right);
  y -= 8;
  row(labels.total, labels.money(c.amount, c.currency), { bold: true, size: 12, color: INK });
  if (kind === 'receipt') {
    row(labels.amountPaid, labels.money(c.paid_amount ?? c.amount, c.currency), {
      bold: true,
      size: 12,
      color: STATUS_COLOR.paid
    });
  } else if (status !== 'void') {
    row(labels.balanceDue, labels.money(status === 'paid' ? 0 : c.amount, c.currency), {
      bold: true
    });
  }
  w.text(labels.currencyNote, amountX, y, { size: 8, color: MUTED, align: 'right' });
  y -= 34;

  // ---- notice
  const notice =
    kind === 'receipt'
      ? labels.receiptNotice
      : status === 'void'
        ? labels.voidNotice
        : status === 'paid'
          ? labels.paidNotice
          : labels.dueNotice;
  if (notice) {
    const lines = w.wrap(notice, 9.5, right - M - 24);
    // Box centred on the text: 10 pt above the cap height, 10 pt below the baseline.
    const bottom = y - (lines.length - 1) * 13 - 10;
    w.page.drawRectangle({
      x: M,
      y: bottom,
      width: right - M,
      height: y + 17 - bottom,
      color: FILL
    });
    lines.forEach((line, i) => w.text(line, M + 12, y - i * 13, { size: 9.5 }));
  }

  // ---- void watermark
  if (status === 'void') {
    w.page.drawText('VOID', {
      x: 150,
      y: 250,
      size: 140,
      font: fonts.bold,
      color: STATUS_COLOR.overdue,
      opacity: 0.08,
      rotate: degrees(30)
    });
  }

  // ---- footer
  w.rule(54);
  if (labels.questions) w.text(labels.questions, M, 38, { size: 8, color: MUTED });
  w.text(`${title} ${c.invoice_number} · ${labels.page(1, 1)}`, right, 38, {
    size: 8,
    color: MUTED,
    align: 'right'
  });

  return pdf.save();
}

/** `invoice-LU-2026-0001.pdf` / `receipt-…` (localized word, ASCII only). */
export function chargePdfFileName(word: string, invoiceNumber: string): string {
  const base = word
    .normalize('NFKD')
    .replace(/[^\w-]/g, '')
    .toLowerCase();
  return `${base || 'document'}-${invoiceNumber.replace(/[^A-Za-z0-9-]/g, '')}.pdf`;
}

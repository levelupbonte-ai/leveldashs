import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import { inlineText, parseMarkdown, type MdBlock, type MdInline } from '@/lib/markdown';
import type { Contract } from '../api/types';

/**
 * Signed-contract PDF (pdf-lib, standard fonts, no external assets): cover with
 * the order form, the official English agreement, the French translation when
 * there is one, and a signature certificate page. Text is laid out from the same
 * Markdown tree as the dashboard, so the PDF shows exactly the stored snapshot.
 */

export interface ContractPdfLabels {
  brand: string;
  signedCopy: string;
  unsignedCopy: string;
  client: string;
  contractId: string;
  version: string;
  orderForm: string;
  orderFormEmpty: string;
  project: string;
  package: string;
  buildPrice: string;
  paymentSchedule: string;
  monthlyPlan: string;
  monthlyPrice: string;
  startDate: string;
  scope: string;
  notes: string;
  agreement: string;
  translation: string;
  translationNotice: string;
  certificate: string;
  certificateIntro: string;
  signer: string;
  signerTitle: string;
  email: string;
  signedAt: string;
  sentAt: string;
  ip: string;
  userAgent: string;
  consent: string;
  consentText: string;
  hash: string;
  hashNote: string;
  drawnSignature: string;
  typedSignature: string;
  page: (current: number, total: number) => string;
  money: (amount: number) => string;
  date: (isoDate: string) => string;
}

const PAGE = { width: 612, height: 792 }; // US Letter
const MARGIN = { x: 60, top: 64, bottom: 64 };
const INK = rgb(0.08, 0.08, 0.09);
const MUTED = rgb(0.42, 0.42, 0.46);
const RULE = rgb(0.86, 0.86, 0.88);
const ACCENT = rgb(0.2, 0.2, 0.22);

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
  mono: PDFFont;
}

interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  mono?: boolean;
}

const REPLACEMENTS: Record<string, string> = {
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
  '‑': '-',
  '−': '-',
  '→': '->',
  '≤': '<=',
  '≥': '>=',
  '✓': 'v'
};

class Writer {
  doc: PDFDocument;
  fonts: Fonts;
  page!: PDFPage;
  y = 0;
  private charsets = new Map<PDFFont, Set<number>>();

  constructor(doc: PDFDocument, fonts: Fonts) {
    this.doc = doc;
    this.fonts = fonts;
    this.newPage();
  }

  newPage() {
    this.page = this.doc.addPage([PAGE.width, PAGE.height]);
    this.y = PAGE.height - MARGIN.top;
  }

  get width() {
    return PAGE.width - MARGIN.x * 2;
  }

  ensure(height: number) {
    if (this.y - height < MARGIN.bottom) this.newPage();
  }

  /** Standard fonts only cover WinAnsi: map or replace anything else. */
  clean(text: string, font: PDFFont): string {
    let set = this.charsets.get(font);
    if (!set) {
      set = new Set(font.getCharacterSet());
      this.charsets.set(font, set);
    }
    let out = '';
    for (const ch of text.replace(/[\t\r\n]+/g, ' ')) {
      const code = ch.codePointAt(0)!;
      if (set.has(code)) out += ch;
      else if (REPLACEMENTS[ch]) out += REPLACEMENTS[ch];
      else out += '?';
    }
    return out;
  }

  font(run: Run): PDFFont {
    if (run.mono) return this.fonts.mono;
    if (run.bold && run.italic) return this.fonts.boldItalic;
    if (run.bold) return this.fonts.bold;
    if (run.italic) return this.fonts.italic;
    return this.fonts.regular;
  }

  /** Lays out runs with word wrapping; returns the lines (for measuring tables). */
  wrap(runs: Run[], size: number, maxWidth: number): { text: string; font: PDFFont }[][] {
    const lines: { text: string; font: PDFFont }[][] = [];
    let line: { text: string; font: PDFFont }[] = [];
    let lineWidth = 0;
    for (const run of runs) {
      const font = this.font(run);
      const words = this.clean(run.text, font).split(/(\s+)/);
      for (const word of words) {
        if (!word) continue;
        const isSpace = /^\s+$/.test(word);
        const piece = isSpace ? ' ' : word;
        const w = font.widthOfTextAtSize(piece, size);
        if (!isSpace && lineWidth + w > maxWidth && lineWidth > 0) {
          lines.push(line);
          line = [];
          lineWidth = 0;
        }
        if (isSpace && lineWidth === 0) continue;
        // A single word wider than the line (hashes, URLs): split by characters.
        if (!isSpace && w > maxWidth) {
          let chunk = '';
          for (const ch of piece) {
            if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth - lineWidth && chunk) {
              line.push({ text: chunk, font });
              lines.push(line);
              line = [];
              lineWidth = 0;
              chunk = '';
            }
            chunk += ch;
          }
          if (chunk) {
            line.push({ text: chunk, font });
            lineWidth += font.widthOfTextAtSize(chunk, size);
          }
          continue;
        }
        line.push({ text: piece, font });
        lineWidth += w;
      }
    }
    if (line.length) lines.push(line);
    return lines;
  }

  drawLine(
    parts: { text: string; font: PDFFont }[],
    x: number,
    y: number,
    size: number,
    color = INK
  ) {
    let cx = x;
    for (const part of parts) {
      this.page.drawText(part.text, { x: cx, y, size, font: part.font, color });
      cx += part.font.widthOfTextAtSize(part.text, size);
    }
  }

  text(
    runs: Run[],
    opts: {
      size?: number;
      indent?: number;
      gap?: number;
      color?: typeof INK;
      lineHeight?: number;
    } = {}
  ) {
    const size = opts.size ?? 10;
    const lineHeight = opts.lineHeight ?? size * 1.45;
    const indent = opts.indent ?? 0;
    for (const line of this.wrap(runs, size, this.width - indent)) {
      this.ensure(lineHeight);
      this.y -= lineHeight;
      this.drawLine(line, MARGIN.x + indent, this.y + (lineHeight - size) / 2, size, opts.color);
    }
    this.y -= opts.gap ?? 0;
  }

  rule(gap = 10) {
    this.ensure(gap * 2);
    this.y -= gap;
    this.page.drawLine({
      start: { x: MARGIN.x, y: this.y },
      end: { x: PAGE.width - MARGIN.x, y: this.y },
      thickness: 0.6,
      color: RULE
    });
    this.y -= gap;
  }

  space(h: number) {
    this.y -= h;
  }
}

function runsOf(nodes: MdInline[], style: { bold?: boolean; italic?: boolean } = {}): Run[] {
  const out: Run[] = [];
  for (const node of nodes) {
    if (node.type === 'text' || node.type === 'code') out.push({ text: node.text, ...style });
    else if (node.type === 'strong') out.push(...runsOf(node.children, { ...style, bold: true }));
    else if (node.type === 'em') out.push(...runsOf(node.children, { ...style, italic: true }));
    else if (node.type === 'link') {
      out.push(...runsOf(node.children, style));
      out.push({ text: ` (${node.href})`, ...style });
    }
  }
  return out;
}

function drawTable(w: Writer, block: Extract<MdBlock, { type: 'table' }>, indent: number) {
  const size = 8.5;
  const lineHeight = 11.5;
  const pad = 5;
  const cols = block.header.length;
  const totalWidth = w.width - indent;
  // Wider first columns for short labels, the rest share what is left.
  const widths = Array.from({ length: cols }, (_, i) =>
    cols === 2 ? (i === 0 ? totalWidth * 0.28 : totalWidth * 0.72) : totalWidth / cols
  );
  const rows = [block.header, ...block.rows];
  rows.forEach((row, r) => {
    const cellLines = row.map((cell, c) =>
      w.wrap(runsOf(cell, r === 0 ? { bold: true } : {}), size, widths[c] - pad * 2)
    );
    const height = Math.max(1, ...cellLines.map((l) => l.length)) * lineHeight + pad * 2;
    w.ensure(height);
    let x = MARGIN.x + indent;
    const top = w.y;
    cellLines.forEach((lines, c) => {
      lines.forEach((line, i) => {
        w.drawLine(line, x + pad, top - pad - (i + 1) * lineHeight + 3, size);
      });
      x += widths[c];
    });
    w.y -= height;
    w.page.drawLine({
      start: { x: MARGIN.x + indent, y: w.y },
      end: { x: MARGIN.x + indent + totalWidth, y: w.y },
      thickness: r === 0 ? 0.9 : 0.5,
      color: r === 0 ? ACCENT : RULE
    });
  });
  w.space(8);
}

function drawBlocks(w: Writer, blocks: MdBlock[], indent = 0) {
  for (const block of blocks) {
    switch (block.type) {
      case 'heading': {
        const size = block.level === 1 ? 16 : block.level === 2 ? 12.5 : 11;
        w.ensure(size * 4);
        w.space(block.level <= 2 ? 10 : 6);
        w.text(runsOf(block.children, { bold: true }), { size, indent, gap: 4 });
        break;
      }
      case 'paragraph':
        for (const line of block.lines) w.text(runsOf(line), { indent });
        w.space(6);
        break;
      case 'list':
        block.items.forEach((item, i) => {
          const marker = block.ordered ? `${i + 1}.` : '•';
          w.ensure(15);
          const before = w.y;
          w.text(runsOf(item), { indent: indent + 14 });
          w.page.drawText(marker, {
            x: MARGIN.x + indent + 2,
            y: before - 14.5 + 2.25,
            size: 10,
            font: w.fonts.regular,
            color: INK
          });
        });
        w.space(6);
        break;
      case 'quote': {
        const startPage = w.page;
        const start = w.y;
        drawBlocks(w, block.children, indent + 12);
        if (w.page === startPage) {
          w.page.drawRectangle({
            x: MARGIN.x + indent,
            y: w.y + 4,
            width: 2,
            height: start - w.y - 4,
            color: RULE
          });
        }
        w.space(4);
        break;
      }
      case 'table':
        drawTable(w, block, indent);
        break;
      case 'rule':
        w.rule(8);
        break;
    }
  }
}

/** ISO timestamp as `YYYY-MM-DD HH:MM:SS UTC`. */
const utc = (iso: string) => `${new Date(iso).toISOString().replace('T', ' ').slice(0, 19)} UTC`;

function keyValue(w: Writer, label: string, value: string, mono = false) {
  const labelWidth = 150;
  const size = 9.5;
  const lines = w.wrap([{ text: value, mono }], size, w.width - labelWidth);
  const height = Math.max(1, lines.length) * 13.5 + 4;
  w.ensure(height);
  w.page.drawText(w.clean(label, w.fonts.bold), {
    x: MARGIN.x,
    y: w.y - 11,
    size: 9,
    font: w.fonts.bold,
    color: MUTED
  });
  lines.forEach((line, i) => w.drawLine(line, MARGIN.x + labelWidth, w.y - 11 - i * 13.5, size));
  w.y -= height;
}

export async function buildContractPdf(
  contract: Contract,
  labels: ContractPdfLabels
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(contract.title);
  doc.setAuthor('LevelUp Ecosystem');
  doc.setSubject(`${contract.title} · ${contract.id}`);
  doc.setCreator('LevelUp Dashboard');
  doc.setProducer('LevelUp Dashboard');
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
    mono: await doc.embedFont(StandardFonts.Courier)
  };
  const w = new Writer(doc, fonts);
  const signature = contract.signature;
  const form = contract.orderForm;

  // Cover + order form
  w.text([{ text: labels.brand, bold: true }], { size: 11, color: MUTED, gap: 18 });
  w.text([{ text: contract.title, bold: true }], { size: 22, lineHeight: 28, gap: 4 });
  w.text([{ text: signature ? labels.signedCopy : labels.unsignedCopy }], {
    size: 11,
    color: MUTED,
    gap: 14
  });
  if (form.client) keyValue(w, labels.client, form.client);
  keyValue(w, labels.version, String(contract.templateVersion));
  keyValue(w, labels.contractId, contract.id, true);
  w.rule(12);
  w.text([{ text: labels.orderForm, bold: true }], { size: 13, gap: 6 });
  const rows: [string, string][] = [];
  if (form.projectName) rows.push([labels.project, form.projectName]);
  if (form.packageName) rows.push([labels.package, form.packageName]);
  if (form.buildPrice !== undefined) rows.push([labels.buildPrice, labels.money(form.buildPrice)]);
  if (form.paymentSchedule) rows.push([labels.paymentSchedule, form.paymentSchedule]);
  if (form.monthlyPlan) rows.push([labels.monthlyPlan, form.monthlyPlan]);
  if (form.monthlyPrice !== undefined)
    rows.push([labels.monthlyPrice, labels.money(form.monthlyPrice)]);
  if (form.startDate) rows.push([labels.startDate, labels.date(form.startDate)]);
  if (form.notes) rows.push([labels.notes, form.notes]);
  if (rows.length === 0 && !form.scope?.length) {
    w.text([{ text: labels.orderFormEmpty }], { color: MUTED });
  }
  rows.forEach(([label, value]) => keyValue(w, label, value));
  if (form.scope?.length) {
    w.space(4);
    w.text([{ text: labels.scope, bold: true }], { size: 9.5, color: MUTED, gap: 2 });
    drawBlocks(w, [
      { type: 'list', ordered: false, items: form.scope.map((s) => [{ type: 'text', text: s }]) }
    ]);
  }

  // Official agreement
  w.newPage();
  w.text([{ text: labels.agreement, bold: true }], { size: 9, color: MUTED, gap: 4 });
  w.text([{ text: contract.title, bold: true }], { size: 16, lineHeight: 22, gap: 8 });
  drawBlocks(w, parseMarkdown(contract.body));

  // Translation (for information)
  if (contract.translatedBody) {
    w.newPage();
    w.text([{ text: labels.translation, bold: true }], { size: 9, color: MUTED, gap: 2 });
    w.text([{ text: labels.translationNotice, italic: true }], { size: 9, color: MUTED, gap: 8 });
    drawBlocks(w, parseMarkdown(contract.translatedBody));
  }

  // Signature certificate
  if (signature) {
    w.newPage();
    w.text([{ text: labels.certificate, bold: true }], { size: 18, lineHeight: 24, gap: 4 });
    w.text([{ text: labels.certificateIntro }], { size: 9.5, color: MUTED, gap: 12 });
    keyValue(w, labels.signer, signature.signerName);
    keyValue(w, labels.signerTitle, signature.signerTitle);
    keyValue(w, labels.email, signature.signerEmail);
    if (form.client) keyValue(w, labels.client, form.client);
    keyValue(w, labels.signedAt, utc(signature.signedAt), true);
    if (contract.sentAt) keyValue(w, labels.sentAt, utc(contract.sentAt), true);
    keyValue(w, labels.ip, signature.ip ?? '-', true);
    keyValue(w, labels.userAgent, signature.userAgent ?? '-');
    keyValue(w, labels.consent, labels.consentText);
    keyValue(w, labels.contractId, contract.id, true);
    keyValue(w, labels.version, String(contract.templateVersion));
    keyValue(w, labels.hash, signature.documentHash, true);
    w.text([{ text: labels.hashNote }], { size: 8, color: MUTED, gap: 14 });

    w.ensure(130);
    w.text([{ text: labels.typedSignature, bold: true }], { size: 9, color: MUTED, gap: 2 });
    w.text([{ text: signature.signerName, italic: true }], { size: 20, lineHeight: 28, gap: 10 });
    if (signature.drawnSignature) {
      w.text([{ text: labels.drawnSignature, bold: true }], { size: 9, color: MUTED, gap: 4 });
      const scale = 0.4;
      w.ensure(200 * scale + 10);
      w.page.drawSvgPath(signature.drawnSignature, {
        x: MARGIN.x,
        y: w.y,
        scale,
        borderColor: INK,
        // Scaled with the path: about 1.6 pt on paper.
        borderWidth: 4,
        borderLineCap: 1
      });
      w.y -= 200 * scale + 10;
    }
  }

  // Footer on every page
  const pages = doc.getPages();
  pages.forEach((page, i) => {
    const footer = w.clean(
      `${labels.brand} · ${contract.title} · ${contract.id.slice(0, 8)} · ${labels.page(i + 1, pages.length)}`,
      fonts.regular
    );
    page.drawText(footer, { x: MARGIN.x, y: 34, size: 7.5, font: fonts.regular, color: MUTED });
  });

  return doc.save();
}

export const contractPdfPath = (contract: Pick<Contract, 'organizationId' | 'id'>) =>
  `${contract.organizationId}/${contract.id}.pdf`;

/** File name offered for download: title + signature date, ASCII only. */
export function contractPdfFileName(contract: Contract): string {
  const base = inlineText([{ type: 'text', text: contract.title }])
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase();
  const date = (contract.signedAt ?? contract.sentAt ?? '').slice(0, 10);
  return `${base || 'contract'}${date ? `-${date}` : ''}.pdf`;
}

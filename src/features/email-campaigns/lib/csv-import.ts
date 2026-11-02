import { cleanLine, containsMarkup, isEmail } from '@/lib/validation/sanitize';

/**
 * Reads a contacts CSV in the browser: an `email` column (or the first column
 * that holds addresses) and an optional `name` column. Quoted cells, commas,
 * semicolons and tabs are understood. The database checks every row again.
 */

export interface ImportRow {
  email: string;
  name: string | null;
}

export interface ParsedImport {
  rows: ImportRow[];
  invalid: number;
  duplicates: number;
}

export const IMPORT_MAX_ROWS = 5000;

function splitCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        cell += c;
      }
    } else if (c === '"' && cell === '') {
      quoted = true;
    } else if (c === delimiter) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += c;
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

function detectDelimiter(firstLine: string): string {
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length] as const);
  return counts.toSorted((a, b) => b[1] - a[1])[0]![0];
}

export function parseContactsCsv(input: string): ParsedImport {
  const text = input.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const table = splitCsv(text, detectDelimiter(firstLine));
  if (!table.length) return { rows: [], invalid: 0, duplicates: 0 };

  const header = table[0]!.map((h) => h.trim().toLowerCase());
  const hasHeader = header.some(
    (h) => /^(e-?mail|courriel|adresse)/.test(h) || /^(name|nom|full.?name)$/.test(h)
  );
  let emailCol = header.findIndex((h) =>
    /^(e-?mail|courriel|adresse e-?mail|email address)$/.test(h)
  );
  const nameCol = header.findIndex((h) => /^(name|nom|full.?name|nom complet)$/.test(h));
  const body = hasHeader ? table.slice(1) : table;
  if (emailCol < 0) {
    emailCol = Math.max(
      0,
      (body[0] ?? []).findIndex((v) => isEmail(v.trim().toLowerCase()))
    );
  }

  const seen = new Set<string>();
  const rows: ImportRow[] = [];
  let invalid = 0;
  let duplicates = 0;
  for (const r of body) {
    const email = (r[emailCol] ?? '').trim().toLowerCase();
    if (!isEmail(email)) {
      invalid++;
      continue;
    }
    if (seen.has(email)) {
      duplicates++;
      continue;
    }
    seen.add(email);
    const rawName = nameCol >= 0 ? cleanLine(r[nameCol] ?? '').slice(0, 120) : '';
    rows.push({ email, name: rawName && !containsMarkup(rawName) ? rawName : null });
  }
  return { rows, invalid, duplicates };
}

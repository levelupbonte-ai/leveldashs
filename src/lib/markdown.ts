/**
 * Small, safe Markdown parser for LevelUp documents (contracts). It understands
 * the subset our legal texts use — headings, paragraphs (line breaks kept),
 * bullet and numbered lists, block quotes, tables, rules, **bold**, *italic*,
 * `code` and [links](https://…) — and returns plain data. Raw HTML is never
 * interpreted: it stays text. The same tree feeds the React renderer
 * (`@/components/markdown`) and the PDF generator.
 */

export type MdInline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: MdInline[] }
  | { type: 'em'; children: MdInline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: MdInline[] };

export type MdBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4; children: MdInline[] }
  | { type: 'paragraph'; lines: MdInline[][] }
  | { type: 'list'; ordered: boolean; items: MdInline[][] }
  | { type: 'quote'; children: MdBlock[] }
  | { type: 'table'; header: MdInline[][]; rows: MdInline[][][] }
  | { type: 'rule' };

const SAFE_HREF = /^(https:\/\/|http:\/\/|mailto:)[^\s"'<>]+$/i;

/** Only http(s) and mailto links survive; anything else is rendered as text. */
export function safeHref(href: string): string | null {
  return SAFE_HREF.test(href) ? href : null;
}

const INLINE = /(\*\*[^*\n]+?\*\*|\*[^*\s][^*\n]*?\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\))/;

export function parseInline(text: string): MdInline[] {
  const out: MdInline[] = [];
  let rest = text;
  while (rest) {
    const match = INLINE.exec(rest);
    if (!match) {
      out.push({ type: 'text', text: rest });
      break;
    }
    if (match.index > 0) out.push({ type: 'text', text: rest.slice(0, match.index) });
    const token = match[0];
    if (token.startsWith('**')) {
      out.push({ type: 'strong', children: parseInline(token.slice(2, -2)) });
    } else if (token.startsWith('`')) {
      out.push({ type: 'code', text: token.slice(1, -1) });
    } else if (token.startsWith('[')) {
      const [, label, href] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token) ?? [];
      const safe = href ? safeHref(href) : null;
      out.push(
        safe
          ? { type: 'link', href: safe, children: parseInline(label ?? '') }
          : { type: 'text', text: label ?? token }
      );
    } else {
      out.push({ type: 'em', children: parseInline(token.slice(1, -1)) });
    }
    rest = rest.slice(match.index + token.length);
  }
  return out;
}

/** Plain text of inline nodes (search, PDF fallbacks, aria labels). */
export function inlineText(nodes: MdInline[]): string {
  return nodes
    .map((n) => (n.type === 'text' || n.type === 'code' ? n.text : inlineText(n.children)))
    .join('');
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => parseInline(c.trim()));

const isTableRule = (line: string) =>
  /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);

export function parseMarkdown(source: string): MdBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MdBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    // Block quote: gather the `>` lines and parse their content recursively.
    if (/^\s*>/.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        inner.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'quote', children: parseMarkdown(inner.join('\n')) });
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1].length as 1 | 2 | 3 | 4,
        children: parseInline(heading[2].trim())
      });
      i++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: 'rule' });
      i++;
      continue;
    }
    if (/^\s*\|/.test(line) && i + 1 < lines.length && isTableRule(lines[i + 1])) {
      const header = cells(line);
      i += 2;
      const rows: MdInline[][][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        rows.push(cells(lines[i]));
        i++;
      }
      blocks.push({ type: 'table', header, rows });
      continue;
    }
    const bullet = /^\s*[-*•]\s+/;
    const numbered = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line) && !bullet.test(line);
      const marker = ordered ? numbered : bullet;
      const items: MdInline[][] = [];
      while (i < lines.length && marker.test(lines[i])) {
        items.push(parseInline(lines[i].replace(marker, '').trim()));
        i++;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }
    // Paragraph: consecutive plain lines; each line keeps its own break (clauses
    // such as "12.1 …" / "12.2 …" are written on consecutive lines). A list that
    // follows a line without a blank line (e.g. "1.3 Definitions." + bullets)
    // starts its own block.
    const para: MdInline[][] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*(>|#{1,4}\s|[-*•]\s|\|)/.test(lines[i]) &&
      !/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])
    ) {
      para.push(parseInline(lines[i].trim()));
      i++;
    }
    if (para.length) blocks.push({ type: 'paragraph', lines: para });
    else i++;
  }
  return blocks;
}

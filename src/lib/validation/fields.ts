import * as z from 'zod';
import {
  cleanLine,
  cleanMultiline,
  containsMarkup,
  isEmail,
  isIsoDate,
  isPhone,
  isSafeRelativePath,
  PATTERNS,
  safeHttpUrl
} from './sanitize';

/**
 * Zod field builders shared by the forms (with translated messages, see
 * `useFields()`) and by the services / route handlers (`fields`, codes only).
 * The same builder gives the same rules on both sides:
 *
 * - every string is cleaned first (`cleanLine` / `cleanMultiline`): parse the
 *   value with the schema and send `parsed.data`, never the raw input;
 * - every string has a maximum length; plain text refuses HTML tags;
 * - formats: email, http(s) URL, https-only URL, phone, slug, hex colour,
 *   calendar date, UUID, one of a fixed list of values.
 *
 * TanStack Form only reads the errors of a schema, not its output: forms call
 * `schema.parse(value)` in `onSubmit` to get the cleaned values.
 */

export interface FieldMessages {
  required?: string;
  tooShort?: (min: number) => string;
  tooLong?: (max: number) => string;
  tooMany?: (max: number) => string;
  noHtml?: string;
  email?: string;
  url?: string;
  phone?: string;
  slug?: string;
  color?: string;
  date?: string;
  choice?: string;
  invalid?: string;
}

export interface TextOptions {
  /** Minimum length after cleaning (1 = required). */
  min?: number;
  /** Keep line breaks (textarea). */
  multiline?: boolean;
  /** Accept HTML-looking text (Markdown documents rendered by our safe renderer). */
  allowMarkup?: boolean;
}

export interface UrlOptions {
  /** https:// only (default: http:// and https://). */
  httpsOnly?: boolean;
  /** Also accept a same-site path such as /projects/x. */
  allowPath?: boolean;
  /** Accept example.com and store https://example.com. */
  allowBareDomain?: boolean;
}

const msg = (message: string | undefined) => (message ? { message } : undefined);
const isHexColor = (v: string) => PATTERNS.hexColor.test(v);

/** An empty string, or a value matching `test` (optional formatted fields). */
const optional = (s: z.ZodString, test: (v: string) => boolean, message?: string) =>
  s.refine((v) => v === '' || test(v), msg(message));

export function createFields(m: FieldMessages = {}) {
  const str = () => z.string(msg(m.invalid));

  /** Plain text: cleaned, bounded, no HTML tags (unless `allowMarkup`). */
  function text(max: number, options: TextOptions = {}) {
    let s = str()
      .overwrite(options.multiline ? cleanMultiline : cleanLine)
      .max(max, msg(m.tooLong?.(max)));
    if (options.min) {
      s = s.min(options.min, msg(options.min === 1 ? m.required : m.tooShort?.(options.min)));
    }
    if (!options.allowMarkup) s = s.refine((v) => !containsMarkup(v), msg(m.noHtml));
    return s;
  }

  /** Email address (lower-cased). `required` refuses the empty string. */
  function email(options: { required?: boolean } = {}) {
    const s = str()
      .overwrite((v) => cleanLine(v).toLowerCase())
      .max(254, msg(m.tooLong?.(254)));
    return options.required
      ? s.min(1, msg(m.required)).refine(isEmail, msg(m.email))
      : optional(s, isEmail, m.email);
  }

  /** Link stored for a website: http(s) URL (normalised), or '' when optional. */
  function url(options: UrlOptions & { required?: boolean } = {}) {
    const valid = (v: string) =>
      (options.allowPath && isSafeRelativePath(v)) ||
      safeHttpUrl(v, { httpsOnly: options.httpsOnly, allowBareDomain: options.allowBareDomain }) !==
        null;
    const s = str()
      .overwrite((v) => {
        const value = cleanLine(v);
        if (options.allowPath && value.startsWith('/')) return value;
        return (
          safeHttpUrl(value, {
            httpsOnly: options.httpsOnly,
            allowBareDomain: options.allowBareDomain
          }) ?? value
        );
      })
      .max(2048, msg(m.tooLong?.(2048)));
    return options.required
      ? s.min(1, msg(m.required)).refine(valid, msg(m.url))
      : optional(s, valid, m.url);
  }

  function phone(options: { required?: boolean } = {}) {
    const s = str()
      .overwrite(cleanLine)
      .max(40, msg(m.tooLong?.(40)));
    return options.required
      ? s.min(1, msg(m.required)).refine(isPhone, msg(m.phone))
      : optional(s, isPhone, m.phone);
  }

  function slug(max = 64) {
    return str()
      .overwrite((v) => cleanLine(v).toLowerCase())
      .min(1, msg(m.required))
      .max(max, msg(m.tooLong?.(max)))
      .regex(PATTERNS.slug, msg(m.slug));
  }

  function hexColor(options: { required?: boolean } = {}) {
    const s = str().overwrite((v) => cleanLine(v).toLowerCase());
    return options.required
      ? s.min(1, msg(m.required)).refine(isHexColor, msg(m.color))
      : optional(s, isHexColor, m.color);
  }

  /** YYYY-MM-DD calendar date, or '' when optional. */
  function date(options: { required?: boolean } = {}) {
    const s = str().overwrite(cleanLine);
    return options.required
      ? s.min(1, msg(m.required)).refine(isIsoDate, msg(m.date))
      : optional(s, isIsoDate, m.date);
  }

  function uuid() {
    return str().regex(PATTERNS.uuid, msg(m.invalid));
  }

  /** One of a fixed list of values. */
  function oneOf<const T extends readonly [string, ...string[]]>(values: T) {
    return z.enum(values, msg(m.choice));
  }

  /** Amount in currency units: digits with up to 2 decimals, '' when optional. */
  function amount(options: { required?: boolean; max?: number } = {}) {
    const max = options.max ?? 10_000_000;
    const valid = (v: string) => /^\d{1,9}(\.\d{1,2})?$/.test(v) && Number(v) <= max;
    const s = str().overwrite((v) => cleanLine(v).replace(',', '.'));
    return options.required
      ? s.min(1, msg(m.required)).refine(valid, msg(m.invalid))
      : optional(s, valid, m.invalid);
  }

  /** A list of short labels (tags, keywords), each cleaned and bounded. */
  function tags(maxItems: number, maxLength: number) {
    return z.array(text(maxLength, { min: 1 })).max(maxItems, msg(m.tooMany?.(maxItems)));
  }

  return { text, email, url, phone, slug, hexColor, date, uuid, oneOf, amount, tags };
}

export type Fields = ReturnType<typeof createFields>;

/** Server-side builders: same rules, no messages (errors become codes). */
export const fields = createFields();

/**
 * Parses `input` with `schema`; on failure throws `onError()` (an `AppError`
 * in services) so raw validation details never reach the screen.
 */
export function parseOrThrow<S extends z.ZodType>(
  schema: S,
  input: unknown,
  onError: () => Error
): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw onError();
  return parsed.data;
}

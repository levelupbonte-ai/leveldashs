# Input security

Everything a person types is checked before it is sent, and checked again where it is received. The database (RLS, `SECURITY DEFINER` functions, constraints) stays the final authority; the app layers below make sure bad input is refused early, with a clear translated message, and never reaches a model, an e-mail or a website as-is.

## Shared validators: `src/lib/validation/`

| File | Purpose |
| --- | --- |
| `sanitize.ts` | Pure helpers: `cleanLine` / `cleanMultiline` (NFC, control, zero-width, bidi-override and Unicode-tag characters removed, whitespace tidied), `containsMarkup`, `containsDangerousContent`, `safeHttpUrl`, `isSafeRelativePath`, `safeLinkHref`, `mailtoHref`, `telHref`, `isWebOrigin`, `safeFileName`, `escapeHtml`, `cleanHeader`, `cleanJson`, `findUnsafeJson`, `PATTERNS` (email, phone, slug, hex colour, date, UUID, domain). |
| `fields.ts` | Zod builders (`createFields(messages)`, `fields` for the server): `text(max, { min, multiline, allowMarkup })`, `email`, `url({ httpsOnly, allowPath, allowBareDomain })`, `phone`, `slug`, `hexColor`, `date`, `uuid`, `oneOf`, `amount`, `tags`. Every string is cleaned first, bounded, and plain text refuses HTML tags. |
| `use-fields.ts` | `useFields()` / `useFieldMessages()`: the same builders with the `validation.*` messages (en/fr). |
| `http.ts` | Route handlers: `readJsonBody(request, schema, { maxBytes })` (same origin, JSON only, size cap, schema), `isSameOrigin`, `guardMutation`, `errorResponse`. |
| `prompt.ts` | Assistant: `cleanPromptInput`, `looksLikeInjection`, `promptData`, `redactSecrets`, `leaksInstructions`. |
| `validation.test.ts` | Malicious payloads: script tags, `javascript:` URLs, encoded variants, oversized strings, unknown keys, CSRF, hidden characters, prompt injection. `bun run test`. |

## Rules

- **Forms**: schema built with `useFields()`; `onSubmit` sends `schema.parse(value)` (TanStack Form only reads a schema's errors, not its cleaned output). Submit buttons are `form.SubmitButton` or a `LoadingButton` bound to the pending state.
- **Services** re-check what they write: collection items (`sanitizeRow`), site settings and page content (`sanitizeContent`: `cleanJson` + `findUnsafeJson`), staff notes, allowed origins, media file names. They throw `AppError('invalidValues')`, shown with `useErrorMessage()`.
- **Route handlers** use `readJsonBody` with a `z.strictObject` schema (unknown keys refused) and the smallest sensible `maxBytes`; body-less mutations still require `{}`. Errors are short codes (`forbidden`, `too_large`, `invalid`), never validation or database details.
- **Rendering**: no `dangerouslySetInnerHTML` with stored or typed content. Markdown goes through `@/components/markdown` (raw HTML stays text, http(s)/mailto links only). Links built from data use `safeLinkHref` / `safeHttpUrl` / `mailtoHref` / `telHref` and `rel={EXTERNAL_LINK_REL}`; anything else is shown as text.
- **E-mails** (`src/lib/email`): every value escaped, the subject one header-safe line, recipients validated, buttons https only, attachment names safe.
- **Uploads**: type allow-list, size caps, magic-byte check (`src/lib/file-signature.ts`, SVG never accepted), random storage paths, safe display names.
- **Redirects**: `next` parameters go through `safeNext` (same-site path, or an https URL of a listed LevelUp app).
- **Assistant**: user messages are cleaned and role markers neutralised; untrusted text (tool results, text to polish) is passed as data (`untrusted_data`, `promptData`); the system prompt forbids revealing its rules or any key; replies are scanned (`redactSecrets`, `leaksInstructions`). Tools run with the signed-in user's client (RLS) and only *propose* changes: applying one goes through the same service checks.
- **Headers**: see [deployment.md](./deployment.md#security-headers) (CSP enforced + report-only allowlist, HSTS, frame denial, nosniff, Permissions-Policy).

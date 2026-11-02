# Email campaigns

Clients (business owners) e-mail **their own customers**: the people who subscribed
on their website. Page: **My site → Email campaigns** (`/dashboard/site/email-campaigns`),
tabs *Campaigns*, *Create / Edit* and *Contacts*. Legal and safe by design: opted-in
contacts only, a footer that cannot be removed, one-click unsubscribe, quotas and an
automatic pause.

Migration: `20261031130000_email_campaigns.sql` (applied). SQL suite:
`supabase/tests/email_campaigns.sql` (rolled back, must show `0 failed`; 83/83 on the
live project). Unit tests: `src/features/email-campaigns/lib/render.test.ts`,
`src/features/email-campaigns/server/webhook-signature.test.ts`.

## Who can do what

| Role | Can |
|---|---|
| viewer | See campaigns, numbers and contacts (addresses and names masked, no address search) |
| editor | + create and edit drafts, send a test to their own address |
| admin, owner | + sender details, send now, schedule, import, export, unsubscribe a contact who asked |
| LevelUp staff (aal2) | admin rights through `has_org_role`, plus the worker key and resuming a paused website |

Every rule is checked in the database (`email_*` functions, SECURITY DEFINER,
`search_path = ''`); the tables have RLS on and no grants to the API roles. Writes
are audited in `site_audit_log` (`email.*`); staff actions in `hq_audit_log`.

## Audience: opted-in contacts only

`public.email_contacts`, one list per website: email, name, source (`newsletter` /
`import`), consent date and source, status (`subscribed`, `unsubscribed`, `bounced`,
`complained`) and the hash of an unsubscribe token.

- **Newsletter sign-ups** (form type `newsletter`, the explicit opt-in form) become
  contacts through a trigger on `form_submissions` (consent source
  `form:newsletter:<submission id>`); existing ones were backfilled. Someone who
  unsubscribed and signs up again is subscribed again with a new token; bounced and
  complained addresses stay out.
- **Marketing-consent boxes** on other forms: no such field exists today, so only the
  newsletter form counts. `vip_signup` is not used either. To add one later, give the
  form an explicit unticked box and extend `private.email_contact_from_submission`.
- **CSV import** (owners and admins): the person must tick *"I confirm that every
  contact in this file agreed to receive marketing emails from my business."* The
  statement, who confirmed and when are stored in `email_contact_imports`. Existing
  contacts are never changed, so an import cannot resubscribe anyone. 5,000 rows per
  import, 20 imports per hour per website.
- **Never mailed:** anyone not `subscribed`. Checked when the audience is snapshotted
  and again when each batch is claimed (a contact who unsubscribed in between is
  `skipped`).

**Unsubscribe token.** `base64url(HMAC-SHA256(key, "<contact id>:<version>"))`, 43
characters, with a random 256-bit key generated in the database and kept in Vault
(`email_unsubscribe_key_v1`). Only its SHA-256 is stored. It is the same in every
e-mail to that contact (old links keep working), only reaches that contact, and is
replaced when the contact signs up again. A second use changes nothing.

## Templates and content

Six templates (`src/features/email-campaigns/lib/render.ts`): Newsletter,
Announcement, Promotion, Event, Simple letter, Thank you. Table layout, inline styles,
600 px column that shrinks on phones, hidden preview text, plain-text part. Each uses
the website's logo (website branding `logo_url`, else the organization logo; https
only, never SVG), the brand colour (sender details, else branding `primary_color`) and
the business name.

The editor takes a subject (120 characters, counter), preview text (150), heading
(150), body (10,000), an optional button (label 40, http(s) link) and an optional
image from the website's media library. The body understands paragraphs, line
breaks, `**bold**` and `[label](https://link)` only. HTML is refused by the database
(`private.check_text`) and every value is escaped by the renderer; the live preview
renders the same function in a sandboxed iframe.

## Compliance, built in

Every e-mail (and the test) has, in the footer the user cannot edit:

- the business name and **postal address** (CAN-SPAM). Owners and admins enter it in
  *Sender details*; testing, scheduling and sending are refused until it is set
  (`sender_details_required`), and the renderer throws without it;
- *"You're receiving this email because you subscribed on <site>."*;
- an **unsubscribe link** to the public page `/unsubscribe/<token>` (opening it changes
  nothing; its button confirms), plus the headers
  `List-Unsubscribe: <https://dashboard.levelup-ecosystem.com/api/email/unsubscribe/<token>?c=<campaign>>`
  and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058: mail apps
  unsubscribe in one click with a POST).

## Sending

- **From** LevelUp's verified domain (`levelup-ecosystem.com`, the domain of
  `AUTH_EMAIL_FROM`): `"<Business name>" <campaigns@levelup-ecosystem.com>` (override
  the address with `CAMPAIGN_EMAIL_FROM_ADDRESS`), **Reply-To** the business's address
  (sender details, else the website's contact e-mail). Same provider and server-only
  key as the account e-mails (`RESEND_API_KEY`); the browser never sees it and the
  UI never names the provider.
- **Per-site sending domains** (e.g. `news@finalstop.org`) are a future option: verify
  the client's domain with the provider (SPF, DKIM, DMARC), store it per website and
  use it as From. Not built.
- **Test:** *Send test to myself* (editors and up), to the signed-in user's address,
  subject prefixed `[Test]`, inert unsubscribe link. Counts against the quota; 10 per
  hour per person.
- **Send now** (owners and admins, aal2 when enrolled) shows a confirmation with the
  number of subscribed contacts. `email_campaign_send` checks the quota, the daily cap
  and the pause switch, snapshots the subscribed contacts into
  `email_campaign_recipients` in batches of 50 and sets the campaign `sending`.
- **Batches:** a sender claims one batch (rows leased for 3 minutes, contacts
  re-checked), renders one e-mail per recipient, sends the batch with the provider's
  batch API and the idempotency key `lu-campaign-<campaign>-batch-<n>` (the payload is
  deterministic, so a retried batch is never sent twice), then records the result. 429
  and 5xx put the batch back in the queue and stop the run; 5 attempts at most. 700 ms
  between requests keeps under the provider's rate limit (shared with account
  e-mails). A batch whose lease expired (crashed run) is claimed again.
- **Who sends the batches:** the *Send now* request (about 25 seconds of batches), the
  page while an owner or admin keeps it open (every 8 seconds), and the **worker**
  (`/api/email/worker`) in the background. All three can run at once safely.
- **Scheduled campaigns** start when the worker runs after their time; the audience,
  quota and cap are checked again then (a refusal marks the campaign `failed` with its
  reason; owners and admins can bring a scheduled or failed-before-sending campaign
  back to draft). *Schedule* is only shown once the worker is configured.
- Statuses: `draft`, `scheduled`, `sending`, `sent`, `failed`.

## Limits and abuse protection

- **Plan quota** `plans.limits.emails_month`: free 500, starter 2,500, pro 10,000,
  business 50,000 (staff edit them on *LevelUp → Billing → Plans*; empty =
  unlimited). Counts campaign e-mails queued, being sent or sent and test e-mails in
  the UTC month; failed and skipped ones are not counted. Shown in *Billing* (meter
  *Emails this month*, usage tile *Emails sent*) and on the campaigns page. Over the
  limit: `plan_limit_reached` (PT402), the usual upgrade notice.
- **Daily cap per website:** 10,000 e-mails per UTC day
  (`private.email_site_state.daily_cap`, staff can change it in SQL).
- **Rate limits:** 10 sends per hour per website, 60 new drafts per hour, 20
  imports and 20 exports per hour.
- **Automatic pause:** when the delivery webhook reports, over the last 30 days (100
  e-mails sent at least), a **bounce rate ≥ 5 %** or a **complaint rate ≥ 0.3 %**,
  the website is paused: no new send, no batch claimed. The page explains it; staff
  review the list and press *Resume sending* on *LevelUp → Billing → Client email
  campaigns* (`admin_email_resume_site`, audited).

## Numbers

Campaign list and details show recipients, sent, unsubscribed, not sent, and —
once delivery events arrive — delivered and bounced. Opens and clicks are not
tracked (tracking is off on the sending domain), so they are never shown.

## Setup

What the owner sets up (all server-only, **never** `NEXT_PUBLIC_`, mark them
*Sensitive* on Vercel):

1. **Sending:** nothing new. `RESEND_API_KEY` is already set for the account e-mails
   and `levelup-ecosystem.com` is verified. Optional: `CAMPAIGN_EMAIL_FROM_ADDRESS` to
   use another address on that domain.
2. **Worker key:** *LevelUp → Billing → Client email campaigns → Generate a key*
   (staff, aal2). Copy the `lu_mail_…` key into `LEVELUP_EMAIL_KEY`. It is shown once;
   the database keeps its SHA-256; generating a new one revokes the old one.
3. **Scheduler:** set `CRON_SECRET` (32+ random characters) on Vercel and as the
   GitHub repository secret `CRON_SECRET`. The workflow
   `.github/workflows/email-worker.yml` then calls
   `POST /api/email/worker` with `Authorization: Bearer <CRON_SECRET>` every few
   minutes (best effort). On Vercel Pro, a Vercel Cron job on `/api/email/worker`
   works too (Vercel sends the same header).
4. **Bounces and complaints (optional but recommended):** in the e-mail provider's
   dashboard, *Webhooks → Add endpoint*
   `https://dashboard.levelup-ecosystem.com/api/email/webhook`, events
   `email.delivered`, `email.bounced`, `email.complained`,
   `email.delivery_delayed`. Copy its signing secret (`whsec_…`) into
   `RESEND_WEBHOOK_SECRET`. The route checks the signature (`svix-id`,
   `svix-timestamp`, `svix-signature`, 5-minute tolerance) on the raw body and
   records the event with the worker key; account e-mails and unknown events are
   ignored, duplicates by event id. Until the secret is set the route answers 404 and
   the numbers show without delivered / bounced.
5. **Postal address:** each client's owner or admin enters it in *Sender details*
   before the first send (the page asks for it).

Redeploy after changing environment variables. The staff card shows *Sending on*,
*Worker on* and the date of the last delivery event.

## Files

| Piece | Where |
|---|---|
| Renderer, templates, unsubscribe headers (pure) | `src/features/email-campaigns/lib/render.ts` |
| CSV import parser | `src/features/email-campaigns/lib/csv-import.ts` |
| API layer | `src/features/email-campaigns/api/{types,service,queries}.ts` |
| Page and UI | `src/app/dashboard/site/email-campaigns/page.tsx`, `src/features/email-campaigns/components/*` |
| Sending (server-only) | `src/features/email-campaigns/server/sender.ts` |
| Routes | `src/app/api/email/campaigns/[id]/{test,send,process}`, `src/app/api/email/worker`, `src/app/api/email/webhook`, `src/app/api/email/unsubscribe/[token]` |
| Unsubscribe page | `src/app/unsubscribe/[token]/page.tsx` |
| Staff card | `src/features/platform-admin/components/billing/email-sending-card.tsx` |

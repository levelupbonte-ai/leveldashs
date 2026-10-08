# LevelUp Ecosystem API

Every client website reads and writes the same Supabase database
(`levelup-ecosystem`). A website is identified by its public id
(`ws_xxxxxxxxxxxxxxxx`); all of its data carries that id and its
organization id, and Row Level Security keeps tenants apart.

There are three ways to connect a website, from the least to the most code:

| Option | For | Needs the client's code? |
|---|---|---|
| **LevelUp tag** (`levelup.js`) | Any existing site (WordPress, Wix, Shopify, Webflow, HTML) | One line, once |
| **Public API** (RPC over HTTPS) | Sites we build (React, Next.js, Vite…) | Yes |
| **Dashboard** | Clients and LevelUp staff | No |

## 1. Onboard a new client (LevelUp staff)

1. Dashboard → **LevelUp admin → Tous les clients → Nouveau client**: company,
   website name, domain, features, owner e-mail. This calls
   `admin_create_client_site` and returns the `ws_…` id.
   - The owner becomes `owner` of the organization as soon as they create
     their LevelUp account with that e-mail (after verifying it).
   - Allowed domains default to `https://<domain>` and `https://www.<domain>`.
2. Select the site (organization switcher) → **Développeurs**: copy the
   install line and send it to the client or paste it yourself.
3. Fill **SEO**, **Paramètres du site** and the content pages.
4. **Développeurs → État de l'installation** turns *Actif* after the first
   visit on the client's domain.

## 2. LevelUp tag

```html
<script src="https://levelup-ecosystem.com/sdk/v1/levelup.js" data-site="ws_xxxxxxxxxxxxxxxx" defer></script>
```

Place it before `</body>` on every page (or in the site builder's "custom
code" / footer field).

What it does:

- **SEO** from the `seo` website setting (dashboard → SEO): `<title>`, meta
  description and keywords, canonical, Open Graph and Twitter cards, Google
  Search Console verification, and schema.org JSON-LD built from the
  contact, hours, social and review data (`BarberShop`, `Restaurant`, …).
  Per-page values come from `seo.pages["/path"]`. Turn it off with
  `data-seo="off"`.
- **Forms**: add `data-lu-form="contact|quote|newsletter|vip_signup|registration"`
  to any `<form>`. Fields `name`, `email`, `phone`, `company` and `message`
  map to columns; other fields go to `data`. A hidden `_hp` field is a
  honeypot. `<p data-lu-status>` shows the result. Turn it off with
  `data-forms="off"`.
- **Content**: `<span data-lu="settings.contact.address"></span>` shows a
  value from the site bundle as text. `data-lu-attr="src|href|alt|title"`
  sets an attribute instead (only `http(s)` URLs).
- **Credit**: `<span data-lu-badge></span>` shows "Built by LevelUp" when
  `show_powered_by` is on.
- **JavaScript API**:

```js
const site = await LevelUp.ready;            // the site bundle (see below)
await LevelUp.submitForm('quote', { name, email, message, budget: '5k' });
await LevelUp.bookAppointment({ service: 'haircut', date: '2026-10-12', time: '10:00', name, email });
await LevelUp.joinWaitlist({ name, phone });
await LevelUp.waitlist();                    // masked public queue
await LevelUp.ticketStatus('FS-ABCD1234');
document.addEventListener('levelup:ready', (e) => console.log(e.detail));
```

Limits: search engines that run JavaScript (Google) read the tags it adds;
link previews on Facebook, WhatsApp and LinkedIn only read the original
HTML, so for those add the same meta tags server-side (WordPress plugin,
site builder SEO fields) when it matters.

## 3. Public API (for sites we build)

Base URL: `https://rncuhmvykrmtxfzqpitc.supabase.co/rest/v1/rpc/<name>`,
`POST`, JSON body, headers `apikey: <publishable key>` and
`Content-Type: application/json`. With supabase-js: `supabase.rpc(name, args)`.

| RPC | Purpose |
|---|---|
| `get_site_bundle(p_website_id)` | Everything public in one call: website, enabled features, public settings, page blocks, services, team, gallery, reviews, FAQ, announcements |
| `get_public_website(p_website_id)` | Website, features and public settings only |
| `submit_form(p_website_id, p_form_type, p_name, p_email, p_phone, p_company, p_message, p_data, p_source)` | Contact, quote, newsletter… → `form_submissions` |
| `book_appointment(p_website_id, p_service_slug, p_date, p_time, p_name, p_email, p_phone, p_team_member_slug, p_notes)` | Booking; price and names come from the database |
| `join_waitlist(…)`, `get_public_waitlist(p_website_id)`, `get_ticket_status(p_website_id, p_ticket_code)` | Walk-in queue |

Errors: `PT403` feature disabled / origin not allowed, `PT404` not found,
`PT409` slot taken, `PT429` rate limited (5 per contact and 300 per site per
hour), `22023` invalid input.

Example (any framework):

```ts
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
const { data: site } = await supabase.rpc('get_site_bundle', { p_website_id: import.meta.env.VITE_WEBSITE_ID });
```

## Security model

- The website id and the publishable key are public by design. They only
  allow what the RPCs and RLS allow: reading published content of a live
  website, and rate-limited writes into that website's inbox.
- `websites.allowed_origins`: browser writes from any other domain are
  rejected (`PT403`). Browsers set `Origin` and pages cannot forge it.
  Managed by LevelUp staff (dashboard → Développeurs, or
  `admin_update_website`).
- Customer data (appointments, waitlist, submissions) is never readable
  publicly; only organization members see it in the dashboard.
- The secret / service-role key is only for LevelUp servers (LevelStudio,
  e-mail functions). It never goes into a web page, a `NEXT_PUBLIC_` or a
  `VITE_` variable.
- Content inserted by the tag is set as text (`textContent`), URLs are
  restricted to `http(s)`, JSON-LD is escaped.

## Admin RPCs (platform admins only)

| RPC | Purpose |
|---|---|
| `admin_create_client_site(p_website_name, p_organization_name, p_organization_id, p_primary_domain, p_site_type, p_features, p_owner_email, p_allowed_origins, p_status)` | Onboard a client |
| `admin_update_website(p_website_id, p_status, p_primary_domain, p_features, p_allowed_origins, p_show_powered_by)` | Change LevelUp-controlled fields |
| `add_organization_member(p_organization_id, p_email, p_role)` | Add or invite a member (org admins too) |

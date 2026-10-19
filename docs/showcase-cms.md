# Showcase CMS

Three collections of the site editor drive the LevelUp showcase site
(levelup-ecosystem.com, repository `app.levelup-ecosystem`) without code:
**Content > Templates**, **Case studies** and **Page sections**
(`/dashboard/site/templates`, `/case-studies`, `/page-sections`). They appear
only for websites with the feature `showcase_cms` (enabled for
`ws_6e797257f5b32b86`). The site side is documented in
`app.levelup-ecosystem/docs/showcase-cms.md`.

## Data

| Table | Rows | Notes |
| --- | --- | --- |
| `showcase_templates` | Demo-site templates | slug, name, url (https), domain, category / tagline / description / features (EN + FR), desktop + mobile image, layout, animation, accent, featured_on_home, sort_order, status |
| `showcase_projects` | Client projects and case studies | slug, name, url (https or a site path), domain, year, label / industry / location / project status / scope / summary / what we built / tags / steps (EN + FR), card fields for /projects, desktop / mobile / cover / gallery images and their descriptions, case_study, layout, animation, accent, featured_on_home, sort_order, status |
| `showcase_sections` | One row per page section | page, section_key (unique per website), enabled, sort_order, eyebrow / title / body (EN + FR), animation (`auto` = as designed) |

* Tenant model and RLS as the other content collections: members read,
  editors write, LevelUp staff as admins, writes blocked while a required
  contract is unsigned (restrictive `*_contract_*` policies), public read of
  published templates / projects and of section rows of a live website.
* Enums are CHECK constraints: status `published | draft | hidden`; layout
  `spotlight | card | band | split-left | split-right`; animation
  `rise | clip | tilt | parallax | none` (sections add `auto`); accent `auto`
  or a section theme key; page `home | projects | services | studio | about |
  pricing | faq | contact`.
* Read path: `get_site_bundle(p_website_id)` returns `showcase: { templates,
  projects, sections }` when the feature is on (published rows only for
  templates and projects, internal columns removed).
* Every write fires `revalidate_site` (`private.ping_site_revalidate`), so the
  site refreshes within seconds.
* Migrations: `20261017100000_showcase_cms.sql` (tables, RLS, feature),
  `20261017100100_showcase_cms_bundle.sql` (RPC), `20261017100200_showcase_cms_seed.sql`
  (the showcase as it was, so nothing changed visually). Tests:
  `supabase/tests/showcase_cms.sql` (rolled back, 25 checks).

## Editor

`src/features/site/config/collections.ts` declares the three collections
(`templates`, `case-studies`, `page-sections`) for the generic editor at
`/dashboard/site/[collection]`. Additions to the generic editor used by them:

* `FieldDef.optionsKey`: select labels from `site.fieldOptions.<key>.<value>`
  (EN / FR friendly labels such as "Spotlight (large)", "Curtain reveal").
* `FieldDef.defaultValue` for new items, `FieldDef.group` for titled groups
  of fields (`site.fieldGroups.*`: General, English text, French text,
  Images, Card on the projects page, Display).
* Field kind `images`: an ordered gallery (upload, paste a link, move, remove).
* `CollectionDef.groupBy` (sections grouped by page), `reorder` (move up /
  down buttons that rewrite `sort_order` 10, 20, ... within the group),
  `badges` (layout, animation, "Home page" on the cards), `liveHint` ("changes
  appear on the site within a few seconds" with a link to the site).
* `SelectField` passes its options to Base UI so the trigger shows the label.

Messages: `site.collections.templates|case-studies|page-sections`,
`site.fieldOptions`, `site.fieldGroups`, `site.fieldBadges`, `nav.items.showcase*`
in `messages/en.json` and `messages/fr.json`.

## Layouts and animations (what the site does)

| Layout | Home page | /projects |
| --- | --- | --- |
| Spotlight (large) | Large row, picture side alternating | Pinned, scroll-scrubbed showcase |
| Image left / Image right | Large row, picture on that side | Same |
| Horizontal band | Consecutive band items slide sideways on large screens | Same |
| Card | Compact card grid | Compact card grid |

| Animation | Effect |
| --- | --- |
| Rise | Fades in and rises |
| Curtain reveal | Clip-path wipe, picture settles from a zoom |
| Tilt | Rises from a slight 3D tilt (default) |
| Depth / parallax | Picture drifts against the scroll |
| None | No entrance |

Image sizes: desktop 1440 x 900 (16:10); template phone 780 x 1688; project
phone 440 px wide, full page; /projects list image about 1278 x 596; gallery
at least 1200 px wide. Upload them in the form (media library, 10 MB max).

# Free sites (phase 1): publish from LevelStudio

A person builds a site in LevelStudio and presses **Publish**. The site goes
online, for free, at `https://<subdomain>.<sites domain>`. It becomes a real
LevelUp website in their own organization, so it shows up in their dashboard.
Its forms, page views and SEO go through the LevelUp tag.

Plan and later phases (security review, plans by AI quality, custom domains,
merchant payments, export): the owner's plan "Sites gratuits LevelUp".

## Where things live

| Piece | Where |
| --- | --- |
| Database: publications, address rules, publish / unpublish / serve RPCs | `supabase/migrations/20261123100000_free_sites.sql` |
| Free-sites domain (one row) | `private.sites_config.root_domain` (placeholder `levelup.site` until the owner picks the domain) |
| Publish routes, site serving, host gate | LevelStudio `server/routes/hosting.ts` |
| HTML preparation, site security policy, address rules | LevelStudio `server/lib/hosting.ts` |
| Routing published-site hosts to the API function | LevelStudio `middleware.ts` (Vercel Routing Middleware) |
| "Publish" button and dialog | LevelStudio `src/components/PublishDialog.tsx` |

## How publishing works

1. Signed-in owner only.
   - The account's e-mail must be confirmed.
   - A site that asks for passwords or card numbers is refused (`blocked_content`).
2. `studio_publish_site` (service role only) claims the address and, the first time:
   - uses the person's oldest owned organization, or creates one named after the site;
   - checks the plan's `websites` limit (free plan: 1);
   - creates the website: status `active`, `site_type = 'levelstudio'`, the
     contact form feature, and the site's address as its only allowed origin.
3. LevelStudio prepares the HTML:
   - assets and logo;
   - removes foreign scripts, frames, `<base>`, meta refresh, foreign stylesheets and `javascript:` links;
   - every form becomes `data-lu-form` (named fields, honeypot, status line in the site's language);
   - adds the LevelUp tag with the website id;
   - adds the page router.

   The prepared HTML is stored in `site_publications.html`. Publishing again stores a new version.
4. **Take offline**:
   - deletes the publication and sets the website to `draft`;
   - messages, statistics and settings stay;
   - publishing again brings back the same website.

Address rules:
- 3 to 40 characters: `a-z`, `0-9` and `-`, with no leading, trailing or double hyphen.
- No reserved names (system, payment, brand and LevelUp names), and nothing starting with `levelup`.
- One site per address.

## How a published site is served

- `middleware.ts` sends every request for `*.<sites domain>` to the API function.
- `hostedGate`, the first middleware of the Express app, decides by the **Host header alone**:
  - a site address only ever gets the site;
  - the studio address never shows a site.
- `hosted_site(subdomain)` returns the live site. The site must be `live`, its website `active` and its organization `active`.
- Headers:
  - a strict CSP: scripts only from the page, Tailwind and the LevelUp tag; data only to the LevelUp API; `form-action 'self'`; `frame-ancestors 'none'`; no `unsafe-eval`;
  - `nosniff`, COOP, HSTS;
  - CDN cache `s-maxage=60`, so a new version shows within a minute.
- Free sites (`show_powered_by`) get a small "Made with LevelUp" link, added when the page is served.
- Unknown address: a small "This site doesn't exist (yet)" page with a link to LevelStudio.
- The bare free-sites domain redirects to levelup-ecosystem.com.

The sites domain is not `levelup-ecosystem.com`. So a site's scripts can never
read a dashboard or studio session.

## Turning it on (owner + one setup)

Publishing is **off** until `SITES_ROOT_DOMAIN` is set on the LevelStudio
Vercel project. Until then the button is hidden and the routes answer
`publishing_unavailable`. To switch it on:

1. Buy the free-sites domain.
2. Point it at Vercel. A wildcard needs Vercel's nameservers, or `_acme-challenge` delegated to Vercel.
3. Add `*.<domain>` and `<domain>` to the LevelStudio Vercel project.
4. Set `SITES_ROOT_DOMAIN=<domain>` on the project.
5. `update private.sites_config set root_domain = '<domain>';`
6. Redeploy, then publish a test site and check the dashboard.
7. Later (phase 2): add the domain to the Public Suffix List, so subdomains are isolated from each other in browsers.

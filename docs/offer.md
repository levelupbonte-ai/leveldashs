# The LevelUp offer

One sentence: **LevelUp builds and runs the websites of small businesses.**
Everything else serves that:

- **LevelStudio** (studio.levelup-ecosystem.com) is how people discover us: a
  free AI draft of their site in minutes. It is not a second business.
- **The dashboard** is the client's space, included in their monthly plan.
- Client sites (Black Pater, Final Stop…) are clients and showcases, not products.

## Prices (the only ones)

| What | Price | Where it lives |
| --- | --- | --- |
| AI draft in LevelStudio | free (60 credits once per account) | LevelStudio |
| LevelStudio credits | 5 USD for 50 credits | `private.studio_credit_pack` |
| Website build: showcase site | 850 USD once | showcase `src/lib/offer.ts` |
| Website build: site with bookings or payments | 1,300 USD once | showcase `src/lib/offer.ts` |
| Anything bigger | quote | — |
| **Essential** plan (key `starter`) | 39 USD / month | `public.plans` |
| **Pro** plan (key `pro`) | 99 USD / month | `public.plans` |

- Monthly plans are read from `public.plans` everywhere: the dashboard billing
  page, invoices and the public pricing page (`public.levelup_offer()`, which
  returns the active, listed, paid plans).
- `plans.listed = false` keeps a plan for the organizations already on it
  (renewals keep working) without offering it. `business` (199 USD) is unlisted.
- Retired: the paid human demo (19 USD, see `human-demo.md`), the 11 USD team
  improvement (never built), the "Secure + Care" bundle and "Premium Care".

## The client journey

1. Free draft in LevelStudio (or "Start a project" on the website).
2. "I want this site for real": the project request reaches the team.
3. The team sends the quote/contract for the build (850 or 1,300 USD).
4. The site goes live with the Essential or Pro plan, billed in the dashboard.

## Rules

- A new price is added here first, then in the one place listed above. Never
  hard-code a plan price in a page.
- The goal for now: 5 paying clients (build + plan). New features must serve
  that journey.

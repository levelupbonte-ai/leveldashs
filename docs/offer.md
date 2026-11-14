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
| Website build | **from 500 USD** (event pages from 250 USD), estimated from what the client picks in "Start a project" | showcase `src/lib/site-pricing.ts` |
| Custom systems / anything bigger | quote confirmed by the team | — |
| **Free** plan (key `free`) | 0: every new site starts here | `public.plans` |
| **Essential** plan (key `starter`) | 39 USD / month | `public.plans` |
| **Pro** plan (key `pro`) | 99 USD / month | `public.plans` |
| **Premium** plan (key `business`) | 199 USD / month | `public.plans` |

- Monthly plans are read from `public.plans` everywhere: the dashboard billing
  page, invoices and the public pricing page (`public.levelup_offer()`, which
  returns the active, listed, paid plans). The three paid plans are the same on
  the website and in the dashboard; change them only here and in `public.plans`.
- `plans.listed = false` keeps a plan for the organizations already on it
  (renewals keep working) without offering it.
- Retired: the paid human demo (19 USD, see `human-demo.md`), the 11 USD team
  improvement (never built), the "Secure + Care" bundle and "Premium Care".

## The client journey

1. Free draft in LevelStudio (or "Start a project" on the website).
2. "I want this site for real": the project request reaches the team.
3. The studio shows the estimate (from 500 USD: base + each chosen feature),
   an AI explanation and the recommended plan; the team confirms the quote.
4. The site starts on the free plan and moves to Essential, Pro or Premium when
   the client needs more, billed in the dashboard.

## Rules

- A new price is added here first, then in the one place listed above. Never
  hard-code a plan price in a page.
- The goal for now: 5 paying clients (build + plan). New features must serve
  that journey.

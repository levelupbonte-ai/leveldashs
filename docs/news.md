# News for client portals (Black Pater first)

Official government news about visas, studies and travel, shown in a member's
space for the country of their dossier.

- **Sources**: `private.news_sources` (one row per official RSS/Atom feed:
  Canada IRCC EN/FR, UK Visas and Immigration, US travel advisories, USCIS,
  Service-Public.fr, Campus France, Belgian Foreign Affairs). Each run writes
  `last_status` (`ok`, `empty`, `http_404`, `not_a_feed`, `timeout`…) and
  `last_count`, so a wrong address shows up the next day: fix `feed_url` or set
  `active = false`.
- **Refresh**: `GET /api/news/refresh` (Vercel Cron, daily, `vercel.json`).
  The database refuses a new run within 5 hours (`news_worker_begin`). Auth to
  the database: `LEVELUP_BILLING_KEY`. Optional `CRON_SECRET` locks the address
  to Vercel Cron (and allows `?force=1`).
- **AI cost**: one call per source per day for the new articles only (summary
  EN + FR, topics, "important"), on the `reports` route (free providers first).
  Never per member.
- **Other countries**: `portal_news_guide` → cached official links (30 days,
  shared by all members) or, for paid members (5 new countries a day), one AI
  call that lists official sites; each link is opened and kept only if it
  answers and looks official.
- **Members**: `POST /api/portal/news` from the client website's server
  (portal key + member session), `list` or `guide`. Paid month
  (`member_until > now()`): full feed; trial or ended: a 3-article preview.

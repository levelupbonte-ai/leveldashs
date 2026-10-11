'use client';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';

/**
 * Vercel Web Analytics + Speed Insights: cookieless, no personal data. URLs are
 * sent without their query string so sign-in parameters (`next`, `token_hash`,
 * `code`, e-mail addresses) never leave the browser. Both scripts only report on
 * Vercel deployments (served from `/_vercel/*`).
 */
const stripQuery = <T extends { url: string }>(event: T): T => ({
  ...event,
  url: event.url.split(/[?#]/)[0]
});

export function VercelInsights() {
  return (
    <>
      <Analytics beforeSend={stripQuery} />
      <SpeedInsights beforeSend={stripQuery} />
    </>
  );
}

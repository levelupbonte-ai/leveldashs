'use client';
import { useSiteScope } from '@/features/site/components/use-site-scope';
import { nudgePortalEmails } from '../api/service';

/** After a change that queued e-mails: ask the website to send them now (best effort). */
export function useNudgeEmails() {
  const scope = useSiteScope();
  return () => void nudgePortalEmails(scope.websiteId);
}

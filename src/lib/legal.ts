/**
 * LevelUp legal documents, hosted on the showcase site. `LEGAL_VERSION` is the
 * version people accept at sign-up (table `legal_acceptances`); bump it (YYYY-MM-DD)
 * when the Terms, Acceptable Use Policy or Privacy Policy change materially.
 */
export const LEGAL_VERSION = '2026-10-11';

const SITE = 'https://levelup-ecosystem.com';

export const LEGAL_LINKS = {
  terms: `${SITE}/terms`,
  privacy: `${SITE}/privacy`,
  acceptableUse: `${SITE}/acceptable-use`,
  servicesAgreement: `${SITE}/services-agreement`,
  dpa: `${SITE}/dpa`,
  cookies: `${SITE}/cookies`,
  levelstudioTerms: `${SITE}/levelstudio-terms`
} as const;

export type LegalDocument = keyof typeof LEGAL_LINKS;

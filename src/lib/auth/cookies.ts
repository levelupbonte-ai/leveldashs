export const ACTIVE_ORG_COOKIE = 'lu_org';
export const ACTIVE_WEBSITE_COOKIE = 'lu_site';

export const preferenceCookie = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 365
};

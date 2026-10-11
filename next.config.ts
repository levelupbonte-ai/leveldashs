import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';
import createNextIntlPlugin from 'next-intl/plugin';

// i18n without locale-prefixed routes: the locale comes from the NEXT_LOCALE cookie
// (see src/i18n/request.ts and docs/i18n.md).
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const isProd = process.env.NODE_ENV === 'production';
const SUPABASE = (process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://rncuhmvykrmtxfzqpitc.supabase.co')
  .trim()
  .replace(/\/$/, '');

/**
 * Content-Security-Policy. Two layers (see docs/deployment.md#security-headers):
 * - enforced: the directives that cannot break the app (no framing, no plugins,
 *   no <base>/form hijacking, https only);
 * - report-only: the full allowlist (Supabase, Google Identity Services, Turnstile,
 *   Pwned Passwords, Vercel Analytics). Browsers log violations in the console;
 *   once a production week shows none, move it to the enforced header.
 */
function contentSecurityPolicy(): { enforced: string; reportOnly: string } {
  const enforced = [
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(isProd ? ['upgrade-insecure-requests'] : [])
  ];
  const full = [
    "default-src 'self'",
    // Next.js inline bootstrap scripts need 'unsafe-inline' (no nonce pipeline);
    // React needs 'unsafe-eval' in development only.
    `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"} https://accounts.google.com/gsi/client https://challenges.cloudflare.com https://va.vercel-scripts.com`,
    "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `media-src 'self' blob: ${SUPABASE}`,
    `connect-src 'self' ${SUPABASE} ${SUPABASE.replace(/^https:/, 'wss:')} https://accounts.google.com/gsi/ https://challenges.cloudflare.com https://api.pwnedpasswords.com https://pokeapi.co`,
    'frame-src https://accounts.google.com/gsi/ https://challenges.cloudflare.com',
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    // upgrade-insecure-requests is ignored in report-only (it stays enforced above).
    ...enforced.filter((d) => d !== 'upgrade-insecure-requests')
  ];
  return { enforced: enforced.join('; '), reportOnly: full.join('; ') };
}

function securityHeaders() {
  const csp = contentSecurityPolicy();
  return [
    { key: 'Content-Security-Policy', value: csp.enforced },
    { key: 'Content-Security-Policy-Report-Only', value: csp.reportOnly },
    // Legacy twin of frame-ancestors 'none'.
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    // Google's sign-in popup must keep a handle on this window.
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
    {
      key: 'Permissions-Policy',
      value:
        'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=(), midi=(), magnetometer=(), gyroscope=(), accelerometer=(), browsing-topics=(), publickey-credentials-get=(self), publickey-credentials-create=(self)'
    },
    // Two years, every subdomain, eligible for the browsers' preload list.
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }
  ];
}

// Define the base Next.js configuration
const baseConfig: NextConfig = {
  output: process.env.BUILD_STANDALONE === 'true' ? 'standalone' : undefined,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'api.slingacademy.com',
        port: ''
      },
      {
        protocol: 'https',
        hostname: 'rncuhmvykrmtxfzqpitc.supabase.co',
        port: '',
        pathname: '/storage/v1/object/public/**'
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        port: ''
      }
    ]
  },
  transpilePackages: ['geist'],
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders() }];
  },
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production'
  }
};

let configWithPlugins = withNextIntl(baseConfig);

// Conditionally enable Sentry configuration
if (!process.env.NEXT_PUBLIC_SENTRY_DISABLED) {
  configWithPlugins = withSentryConfig(configWithPlugins, {
    org: process.env.NEXT_PUBLIC_SENTRY_ORG,
    project: process.env.NEXT_PUBLIC_SENTRY_PROJECT,
    // Only print logs for uploading source maps in CI
    silent: !process.env.CI,

    // Upload a larger set of source maps for prettier stack traces (increases build time)
    widenClientFileUpload: true,

    // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
    tunnelRoute: '/monitoring',

    // Disable Sentry telemetry
    telemetry: false,

    // Sentry v10: moved under webpack namespace
    webpack: {
      reactComponentAnnotation: {
        enabled: true
      },
      treeshake: {
        removeDebugLogging: true
      }
    },

    // Disable source map upload when org/project are not configured
    sourcemaps: {
      disable: !process.env.NEXT_PUBLIC_SENTRY_ORG || !process.env.NEXT_PUBLIC_SENTRY_PROJECT
    }
  });
}

const nextConfig = configWithPlugins;
export default nextConfig;

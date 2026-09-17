import type { NextConfig } from 'next';
const config: NextConfig = {
  output: process.env.RENEWAL_STATIC_EXPORT === 'true' ? 'export' : 'standalone',
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? '',
  trailingSlash: process.env.RENEWAL_STATIC_EXPORT === 'true',
  poweredByHeader: false,
  devIndicators: false,
  async headers() { return [{ source: '/:path*', headers: [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  ] }, { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }] }]; },
};
export default config;

import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: '/:path*', headers: [{ key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, max-age=0' }] }];
  },
};
export default nextConfig;

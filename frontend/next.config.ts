
import type { NextConfig } from 'next';

const backendUrl = (process.env.ATTRIBUTION_API_URL || 'http://localhost:8080')
  .replace(/\/+$/, '');

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/backend-api/:path*',
        destination: `${backendUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;

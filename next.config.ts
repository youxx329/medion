import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'nedrug.mfds.go.kr',
        pathname: '/pbp/cmn/itemImageDownload/**',
      },
    ],
  },
};

export default nextConfig;

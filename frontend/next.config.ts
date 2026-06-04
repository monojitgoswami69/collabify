import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  allowedDevOrigins: ['192.168.29.92'],
  experimental: {
    optimizePackageImports: ['lucide-react', 'developer-icons'],
  },
  // Turbopack is the default in Next.js 16. Empty config silences the
  // "webpack config present but no turbopack config" warning.
  turbopack: {},
};

export default nextConfig;

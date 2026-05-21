/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',

  // Bake the API URL in at build time via the env block
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'https://localhost/api',
  },

  // next/image: allow external item images from any HTTPS source.
  // Tighten this to specific hostnames in production.
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
    // Disable image optimization for self-hosted Docker (no serverless function)
    // Remove this line if using Vercel or a platform with built-in optimization.
    unoptimized: true,
  },

  // Disable the experimental block that caused a lint warning in some Next versions
};

module.exports = nextConfig;

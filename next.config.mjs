/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: false },
  typescript: { ignoreBuildErrors: false },
  serverExternalPackages: ['@node-rs/argon2', 'pg', 'pg-boss', 'nodemailer'],
  experimental: { serverActions: { bodySizeLimit: '2mb' } },
};
export default nextConfig;

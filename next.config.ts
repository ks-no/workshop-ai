import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  // This workspace owns a read-only AGENTS.md; preserve it during local development.
  agentRules: false,
  poweredByHeader: false,
  serverExternalPackages: ['pdf-parse'],
  outputFileTracingExcludes: { '*': ['./.data/**/*', './.runtime/**/*', './.env*', './artifacts/**/*', './sources/**/*', './backend/.venv/**/*'] },
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'same-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
    ] }];
  },
};
export default nextConfig;

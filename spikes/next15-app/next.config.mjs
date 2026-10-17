// The smallest config the spike found that runs the SDK in the browser:
// browser-only fs -> ZenFS aliases for both bundlers and the isolation headers
// OPFS / SQLite WASM need.
// distDir is configurable so webpack and Turbopack builds can sit side by side.
import { createRequire } from 'node:module'
import path from 'node:path'

// Next 15 Turbopack only: its server build fails on libsql when the SDK's Node platform is in
// the graph. The SDK is browser-only in Next apps, so every graph gets the browser platform.
// This makes `next build --turbopack` pass, but SQLite still fails at runtime under Next 15
// Turbopack (its blob-URL worker bootstrap can't resolve the WASM URL), so use webpack there.
const require = createRequire(import.meta.url)
const sdkDir = path.dirname(require.resolve('@seedprotocol/sdk/package.json'))
const browserPlatform = './' + path.relative(import.meta.dirname, path.join(sdkDir, 'dist/platform.browser.js'))

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.SPIKE_DIST || '.next',
  turbopack: {
    root: import.meta.dirname,
    resolveAlias: {
      '#seed-node-platform': browserPlatform,
      fs: { browser: '@zenfs/core' },
      'node:fs': { browser: '@zenfs/core' },
      'fs/promises': { browser: '@zenfs/core/promises' },
      'node:fs/promises': { browser: '@zenfs/core/promises' },
    },
  },
  webpack(config, { isServer }) {
    if (!isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        fs: '@zenfs/core',
        'fs/promises': '@zenfs/core/promises',
      }
    }
    return config
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
        ],
      },
    ]
  },
}

export default nextConfig

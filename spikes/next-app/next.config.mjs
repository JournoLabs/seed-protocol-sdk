// The smallest config the spike found that runs the SDK in the browser:
// browser-only fs -> ZenFS aliases for both bundlers, node: prefix stripping for
// webpack's client build, and the isolation headers OPFS / SQLite WASM need.
// distDir is configurable so webpack and Turbopack builds can sit side by side.
/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.SPIKE_DIST || '.next',
  turbopack: {
    root: import.meta.dirname,
    resolveAlias: {
      fs: { browser: '@zenfs/core' },
      'node:fs': { browser: '@zenfs/core' },
      'fs/promises': { browser: '@zenfs/core/promises' },
      'node:fs/promises': { browser: '@zenfs/core/promises' },
    },
  },
  webpack(config, { isServer, webpack }) {
    if (!isServer) {
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
          resource.request = resource.request.replace(/^node:/, '')
        }),
      )
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

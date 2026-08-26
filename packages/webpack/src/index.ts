/**
 * Webpack / Next.js config helper for Seed Protocol apps.
 */
export const withSeed = (config: any, webpack: any, isServer: boolean) => {
  config.plugins.push(
    new webpack.NormalModuleReplacementPlugin(/node:/, (resource: { request: string }) => {
      resource.request = resource.request.replace(/^node:/, '')
    }),
  )

  if (!isServer) {
    config.resolve.alias['fs'] = '@zenfs/core'
    config.resolve.alias['node:fs'] = '@zenfs/core'
    config.resolve.alias['node:path'] = 'path-browserify'
    config.resolve.alias['path'] = 'path-browserify'
  }

  if (isServer) {
    config.externals.push('@sqlite.org/sqlite-wasm')
    config.externals.push('chokidar')
    config.externals.push('arweave')
  }

  return config
}

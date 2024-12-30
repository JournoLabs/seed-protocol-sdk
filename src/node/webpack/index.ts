import path from 'path'

export const withSeed = (config: any, webpack: any, isServer: boolean) => {
  // If you need to include directories outside of the project root
  // config.module.rules.push({
  //   test: /\.ts$/,
  //   include: [path.resolve(process.cwd(), 'schema.ts')],
  //   use: 'ts-loader',
  // })

  config.plugins.push(
    // new webpack.DefinePlugin({
    //   __dirname: JSON.stringify(__dirname),
    // }),
    new webpack.NormalModuleReplacementPlugin(/node:/, (resource) => {
      resource.request = resource.request.replace(/^node:/, '')
    }),
  )

  // config.externals.push({
  //   'fsevents': 'commonjs2 fsevents',
  // })

  // console.log('__dirname:', __dirname)
  // console.log('process.cwd():', process.cwd())

  // console.log('crypto-browserify exists:', fs.existsSync(path.resolve(process.cwd(), './node_modules/crypto-browserify')))
  // console.log('path-browserify exists:', fs.existsSync(path.resolve(process.cwd(), './node_modules/path-browserify')))

  if (!isServer) {
    config.resolve.alias['fs'] = path.resolve(
      process.cwd(),
      './node_modules/@zenfs/core',
    )
    config.resolve.alias['node:fs'] = path.resolve(
      process.cwd(),
      './node_modules/@zenfs/core',
    )
    config.resolve.alias['@schema'] = path.resolve(process.cwd(), 'schema.ts')
    // config.resolve.alias['crypto']      = path.resolve(process.cwd(), './node_modules/crypto-browserify')
    // config.resolve.alias['node:crypto'] = path.resolve(process.cwd(), './node_modules/crypto-browserify')
    config.resolve.alias['node:path'] = path.resolve(
      process.cwd(),
      './node_modules/path-browserify',
    )
    config.resolve.alias['path'] = path.resolve(
      process.cwd(),
      './node_modules/path-browserify',
    )
  }

  if (isServer) {
    config.externals.push('@sqlite.org/sqlite-wasm')
    config.externals.push('nunjucks')
    config.externals.push('chokidar')
    config.externals.push('arweave')
  }

  // config.module.rules.push({
  //   test: /seed\.config\.mjs$/,
  //     use: [
  //       {
  //         loader: 'babel-loader',
  //         options: {
  //           plugins: ['@babel/plugin-syntax-dynamic-import'],
  //         },
  //       },
  //     ],
  // })

  return config
}

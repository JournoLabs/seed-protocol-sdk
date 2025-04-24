import typescript from '@rollup/plugin-typescript'
import { execSync } from 'node:child_process'
import copy from 'rollup-plugin-copy'
import tsConfigPaths from 'rollup-plugin-tsconfig-paths'
import commonjs from '@rollup/plugin-commonjs'
import { typiaProto } from './rollup-typia-proto.js'
// import nodeResolve from '@rollup/plugin-node-resolve'
// import json from '@rollup/plugin-json'
// import webWorkerLoader from 'rollup-plugin-web-worker-loader'
// import polyfillNode from 'rollup-plugin-polyfill-node'

const postProcess = () => {
  return {
    name: 'post-process',
    writeBundle() {
      execSync('chmod +x dist/bin.js')
      execSync('chmod +x dist/rpcServer.js')
      execSync('chmod +x dist/addModel.js')
    },
  }
}

// const entries = {
//   main: 'src/index.ts',
//   bin: 'scripts/bin.ts'
// };

// const formats = [
//   {
//     format: 'esm',
//     extension: '.js'
//   },
//   {
//     format: 'cjs',
//     extension: '.cjs.js'
//   },
//   {
//     format: 'umd',
//     extension: '.umd.js'
//   }
// ];

const config = [
  {
    input: {
      main: 'src/index.ts',
      bin: 'scripts/bin.ts',
      addModel: 'scripts/addModel.ts',
      rpcServer: 'scripts/rpcServer.ts',
    },
    output: [
      {
        dir: 'dist',
        format: 'esm',
        sourcemap: true,
        preserveModules: true,
      },
    ],
    external: [
      'drizzle-orm',
      'path-browserify',
      '@zenfs/core',
      '@zenfs/dom',
      'arweave',
      'tslib',
      'better-sqlite3',
      'react',
      'react-dom',
      'typia',
    ],
    plugins: [
      typescript({
        exclude: ['__tests__/**/*'],
        jsx: 'react',
        tsconfig: './tsconfig.json',
      }),
      tsConfigPaths(),
      // dts(),
      commonjs({
        include: ['node_modules/**'],
        // transformMixedEsModules: true,
      }),
  
      // nodeResolver({
      //   browser: true,
      //   preferBuiltins: false,
      // }),
      typiaProto({
        input: [
          {
            path: 'src/types/index.ts',
            types: ['SeedConfig', 'SeedConstructorOptions', 'Environment']
          },
          {
            path: 'src/types/item.ts',
            types: ['ItemData', 'ItemType', 'ItemMachineContext', 'NewItemProps', 'ItemFindProps', 'CreatePropertyInstanceProps']
          },
          {
            path: 'src/types/model.ts',
            types: ['ModelDefinitions', 'ModelSchema', 'ModelValues', 'ModelClassType']
          },
          {
            path: 'src/seedSchema/ModelSchema.ts',
            types: ['ModelRecordType', 'PropertyType']
          }
        ],
        services: [
          {
            path: 'scripts/rpcServer.ts',
            name: 'SeedService',
            methods: [
              {
                name: 'GetModels',
                inputType: 'Empty',
                outputType: 'ModelsResponse'
              },
              {
                name: 'GetModel',
                inputType: 'ModelRequest',
                outputType: 'ModelResponse'
              },
              {
                name: 'CreateItem',
                inputType: 'CreateItemRequest',
                outputType: 'ItemResponse'
              },
              {
                name: 'GetItem',
                inputType: 'ItemRequest',
                outputType: 'ItemResponse'
              },
              {
                name: 'UpdateItem',
                inputType: 'UpdateItemRequest',
                outputType: 'ItemResponse'
              },
              {
                name: 'DeleteItem',
                inputType: 'ItemRequest',
                outputType: 'StatusResponse'
              },
              {
                name: 'PublishItem',
                inputType: 'ItemRequest',
                outputType: 'StatusResponse'
              },
              {
                name: 'QueryItems',
                inputType: 'QueryRequest',
                outputType: 'ItemsResponse'
              }
            ]
          }
        ],
        outDir: 'dist/protos',
        package: 'seed'
      }),
      copy({
        targets: [
          { src: 'src/db/seedSchema', dest: 'dist/db' },
          { src: 'src/db/configs', dest: 'dist/db' },
          { src: 'src/seedSchema', dest: 'dist' },
          {
            src: 'src/node/codegen/templates/**/*',
            dest: 'dist/node/codegen/templates',
          },
          {
            src: 'src/node/db/node.app.db.config.ts',
            dest: 'dist/node/db',
          },
          {
            src: 'scripts/seedData.json',
            dest: 'dist',
          },
          {
            src: 'scripts/protos',
            dest: 'dist',
          }
        ],
      }),
      postProcess(),
    ],
  },
]


// const bundleConfigs = formats.map(({ format, extension }) => ({
//   input: entries,
//   output: Object.keys(entries).map(entryName => ({
//     dir: 'dist',
//     entryFileNames: `[name]${extension}`,
//     format,
//     name: format === 'umd' ? 'SeedSDK' : undefined,
//     sourcemap: true
//   })),
//   plugins: [
//     typescript({
//       tsconfig: './tsconfig.json',
//       declaration: format === 'esm', // Only generate declarations once
//       declarationDir: './dist/types'
//     }),
//     nodeResolve({
//       browser: true
//     }),
//     commonjs(),
//     json(),
//   ],
//   external: [
//     '@seedprotocol/sdk'
//   ]
// }));

// const typesConfig = {
//   input: Object.fromEntries(
//     Object.keys(entries).map(entryName => [
//       entryName,
//       `./dist/types/${entryName === 'main' ? 'index' : entryName}.d.ts`
//     ])
//   ),
//   output: {
//     dir: 'dist',
//     entryFileNames: '[name].d.ts',
//     format: 'es'
//   },
//   plugins: [dts()]
// };

// export default bundleConfigs
export default config

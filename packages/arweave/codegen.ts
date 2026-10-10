import type { CodegenConfig } from '@graphql-codegen/cli'

const config: CodegenConfig = {
  overwrite: true,
  schema: [
    {
      'https://permagate.io/graphql': {
        headers: {},
      },
    },
  ],
  documents: 'src/**/*.{ts,tsx}',
  generates: {
    'src/graphql/gql/': {
      preset: 'client',
      // Type-only imports, so the output loads as plain ESM (vitest runs it from source).
      config: { useTypeImports: true },
      plugins: [],
    },
  },
}

export default config

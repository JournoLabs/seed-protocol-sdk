import type { CodegenConfig } from '@graphql-codegen/cli'

const config: CodegenConfig = {
  overwrite: true,
  schema: [
    {
      'https://optimism-sepolia.easscan.org/graphql': {
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
    '../../graphql.schema.json': {
      plugins: ['introspection'],
    },
  },
}

export default config

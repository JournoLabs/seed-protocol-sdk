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
      plugins: [],
    },
    '../../graphql.schema.json': {
      plugins: ['introspection'],
    },
  },
}

export default config

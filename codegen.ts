import type { CodegenConfig } from '@graphql-codegen/cli'
import dotenv from 'dotenv'

dotenv.config()

const config: CodegenConfig = {
  overwrite: true,
  schema: [
    {
      'https://optimism-sepolia.easscan.org/graphql': {
        headers: {},
      },
    },
    {
      'https://permagate.io/graphql': {
        headers: {},
      },
    },
  ],
  documents: 'src/**/*.{ts,tsx}',
  generates: {
    'src/browser/gql/': {
      preset: 'client',
      plugins: [],
    },
    './graphql.schema.json': {
      plugins: ['introspection'],
    },
  },
}

export default config

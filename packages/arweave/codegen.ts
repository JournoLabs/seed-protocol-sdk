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
      plugins: [],
    },
  },
}

export default config

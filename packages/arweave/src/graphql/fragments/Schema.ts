import { graphql, } from '../gql'

export const SCHEMA_FIELDS = graphql(/* GraphQL */ `
  fragment schemaFields on Schema {
    id
    resolver
    revocable
    schema
    index
    schemaNames {
      name
    }
    time
    txid
    creator
  }
`,)

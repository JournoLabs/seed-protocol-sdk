import { graphql } from '@/browser/gql'

export const GET_SCHEMA_UIDS_FOR_MODELS = graphql(/* GraphQL */ `
  query GetSchemaUids($where: SchemaWhereInput!) {
    schemaUids: schemata(where: $where) {
      id
      schema
      schemaNames {
        name
      }
    }
  }
`)

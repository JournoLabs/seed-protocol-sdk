import { graphql } from '@/graphql/gql'

export const GET_FILES_METADATA = graphql(/* GraphQL */ `
  query GetFilesMetadata($where: AttestationWhereInput!) {
    filesMetadata: attestations(
      where: $where
      orderBy: [{ timeCreated: desc }]
    ) {
      ...attestationFields
    }
  }
`)

export const GET_ARWEAVE_TRANSACTIONS = graphql(/* GraphQL */ `
  query GetArweaveTransactions(
    $owners: [String!]
    $first: Int
    $after: String
  ) {
    transactions(owners: $owners, first: $first, after: $after) {
      edges {
        cursor
        node {
          id
          anchor
          signature
          block {
            id
            height
          }
          data {
            size
            type
          }
          tags {
            name
            value
          }
        }
      }
      pageInfo {
        hasNextPage
      }
    }
  }
`)

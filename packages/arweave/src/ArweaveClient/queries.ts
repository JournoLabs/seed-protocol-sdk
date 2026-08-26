import { graphql } from '../graphql/gql/index.js'
import { TypedDocumentNode } from '@graphql-typed-document-node/core'

export const GET_TRANSACTION_TAGS = graphql(/* GraphQL */ `
  query GetTransactionTags($transactionId: ID!) {
    tags: transaction(id: $transactionId) {
      id
      tags {
        name
        value
      }
    }
  }
`) as unknown as TypedDocumentNode<{ tags: { id: string; tags: { name: string; value: string }[] } | null }, { transactionId: string }>

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
`) as unknown as TypedDocumentNode<
  {
    transactions: {
      edges: Array<{
        cursor: string
        node: {
          id: string
          anchor: string
          signature: string
          block: { id: string; height: number }
          data: { size: number; type: string }
          tags: Array<{ name: string; value: string }>
        }
      }>
      pageInfo: { hasNextPage: boolean }
    }
  },
  { owners?: string[]; first?: number; after?: string }
>

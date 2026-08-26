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

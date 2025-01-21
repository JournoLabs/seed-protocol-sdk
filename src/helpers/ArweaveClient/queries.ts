import { graphql } from '@/graphql/gql'
import { TypedDocumentNode } from '@graphql-typed-document-node/core'
import { Tag } from '@/graphql/gql/graphql'

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
`) as TypedDocumentNode<{ tags: Tag[] }>

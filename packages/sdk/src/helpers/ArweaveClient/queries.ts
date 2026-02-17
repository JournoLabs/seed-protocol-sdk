import { graphql } from '@/graphql/gql'
import { TypedDocumentNode } from '@graphql-typed-document-node/core'
import { GetTransactionTagsQuery } from '@/graphql/gql/graphql'

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

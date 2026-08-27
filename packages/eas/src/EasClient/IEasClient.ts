import type { GraphQLClient } from 'graphql-request'

export interface IEasClient {
  getEasClient(): GraphQLClient
}

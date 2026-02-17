import { graphql } from '@/graphql/gql'

export const GET_IMAGE_SEEDS = graphql(/* GraphQL */ `
  query GetImageSeeds($where: AttestationWhereInput!) {
    imageSeeds: attestations(where: $where, orderBy: [{ timeCreated: desc }]) {
      id
      decodedDataJson
      attester
      schema {
        schemaNames {
          name
        }
      }
      refUID
      revoked
      schemaId
      txid
      timeCreated
      time
      isOffchain
    }
  }
`)

export const GET_IMAGE_VERSIONS = graphql(/* GraphQL */ `
  query GetImageVersions($where: AttestationWhereInput!) {
    imageVersions: attestations(
      where: $where
      orderBy: [{ timeCreated: desc }]
    ) {
      ...attestationFields
    }
  }
`)

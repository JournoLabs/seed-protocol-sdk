import { graphql } from '@/browser/gql'
import { TypedDocumentNode } from '@graphql-typed-document-node/core'
import { Attestation } from '@/browser/gql/graphql'

export const GET_SCHEMAS = graphql(/* GraphQL */ `
  query GetSchemas($where: SchemaWhereInput!) {
    schemas: schemata(where: $where) {
      id
      schema
      schemaNames {
        name
      }
    }
  }
`)

export const GET_SEEDS = graphql(/* GraphQL */ `
  query GetSeeds($where: AttestationWhereInput!) {
    itemSeeds: attestations(where: $where, orderBy: [{ timeCreated: desc }]) {
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
      timeCreated
      isOffchain
    }
  }
`) as TypedDocumentNode<{ itemSeeds: Attestation[] }>

export const GET_SEED_IDS = graphql(/* GraphQL */ `
  query GetSeedIds($where: AttestationWhereInput!) {
    itemSeedIds: attestations(where: $where, orderBy: [{ timeCreated: desc }]) {
      id
    }
  }
`) as TypedDocumentNode<{ itemSeedIds: Attestation[] }>

export const GET_STORAGE_TRANSACTION_ID = graphql(/* GraphQL */ `
  query GetStorageTransactionId($where: AttestationWhereInput!) {
    storageTransactionId: attestations(
      where: $where
      orderBy: [{ timeCreated: desc }]
    ) {
      id
      decodedDataJson
    }
  }
`) as TypedDocumentNode<{ storageTransactionId: Attestation[] }>

export const GET_VERSIONS = graphql(/* GraphQL */ `
  query GetVersions($where: AttestationWhereInput!) {
    itemVersions: attestations(
      where: $where
      orderBy: [{ timeCreated: desc }]
    ) {
      ...attestationFields
    }
  }
`) as TypedDocumentNode<{ itemVersions: Attestation[] }>

export const GET_PROPERTIES = graphql(/* GraphQL */ `
  query GetProperties($where: AttestationWhereInput!) {
    itemProperties: attestations(
      where: $where
      orderBy: [{ timeCreated: desc }]
    ) {
      ...attestationFields
    }
  }
`) as TypedDocumentNode<{ itemProperties: Attestation[] }>

export const GET_ALL_PROPERTIES_FOR_ALL_VERSIONS = graphql(/* GraphQL */ `
  query GetAllPropertiesForAllVersions($where: AttestationWhereInput!) {
    allProperties: attestations(
      where: $where
      orderBy: [{ timeCreated: desc }]
    ) {
      ...attestationFields
    }
  }
`) as TypedDocumentNode<{ allProperties: Attestation[] }>

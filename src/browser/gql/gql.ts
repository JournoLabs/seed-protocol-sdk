/* eslint-disable */
import * as types from './graphql';
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';

/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 * Learn more about it here: https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#reducing-bundle-size
 */
const documents = {
    "\n  query GetTransactionTags($transactionId: ID!) {\n    tags: transaction(id: $transactionId) {\n      id\n      tags {\n        name\n        value\n      }\n    }\n  }\n": types.GetTransactionTagsDocument,
    "\n  fragment attestationFields on Attestation {\n    id\n    decodedDataJson\n    attester\n    schema {\n      schemaNames {\n        name\n      }\n    }\n    refUID\n    revoked\n    schemaId\n    txid\n    timeCreated\n    time\n    isOffchain\n  }\n": types.AttestationFieldsFragmentDoc,
    "\n  fragment schemaFields on Schema {\n    id\n    resolver\n    revocable\n    schema\n    index\n    schemaNames {\n      name\n    }\n    time\n    txid\n    creator\n  }\n": types.SchemaFieldsFragmentDoc,
    "\n  query GetSchemas($where: SchemaWhereInput!) {\n    schemas: schemata(where: $where) {\n      id\n      schema\n      schemaNames {\n        name\n      }\n    }\n  }\n": types.GetSchemasDocument,
    "\n  query GetSeeds($where: AttestationWhereInput!) {\n    itemSeeds: attestations(where: $where, orderBy: [{ timeCreated: desc }]) {\n      id\n      decodedDataJson\n      attester\n      schema {\n        schemaNames {\n          name\n        }\n      }\n      refUID\n      revoked\n      schemaId\n      timeCreated\n      isOffchain\n    }\n  }\n": types.GetSeedsDocument,
    "\n  query GetSeedIds($where: AttestationWhereInput!) {\n    itemSeedIds: attestations(where: $where, orderBy: [{ timeCreated: desc }]) {\n      id\n    }\n  }\n": types.GetSeedIdsDocument,
    "\n  query GetStorageTransactionId($where: AttestationWhereInput!) {\n    storageTransactionId: attestations(\n      where: $where\n      orderBy: [{ timeCreated: desc }]\n    ) {\n      id\n      decodedDataJson\n    }\n  }\n": types.GetStorageTransactionIdDocument,
    "\n  query GetVersions($where: AttestationWhereInput!) {\n    itemVersions: attestations(\n      where: $where\n      orderBy: [{ timeCreated: desc }]\n    ) {\n      ...attestationFields\n    }\n  }\n": types.GetVersionsDocument,
    "\n  query GetProperties($where: AttestationWhereInput!) {\n    itemProperties: attestations(\n      where: $where\n      orderBy: [{ timeCreated: desc }]\n    ) {\n      ...attestationFields\n    }\n  }\n": types.GetPropertiesDocument,
    "\n  query GetAllPropertiesForAllVersions($where: AttestationWhereInput!) {\n    allProperties: attestations(\n      where: $where\n      orderBy: [{ timeCreated: desc }]\n    ) {\n      ...attestationFields\n    }\n  }\n": types.GetAllPropertiesForAllVersionsDocument,
    "\n  query GetFilesMetadata($where: AttestationWhereInput!) {\n    filesMetadata: attestations(\n      where: $where\n      orderBy: [{ timeCreated: desc }]\n    ) {\n      ...attestationFields\n    }\n  }\n": types.GetFilesMetadataDocument,
    "\n  query GetArweaveTransactions(\n    $owners: [String!]\n    $first: Int\n    $after: String\n  ) {\n    transactions(owners: $owners, first: $first, after: $after) {\n      edges {\n        cursor\n        node {\n          id\n          anchor\n          signature\n          block {\n            id\n            height\n          }\n          data {\n            size\n            type\n          }\n          tags {\n            name\n            value\n          }\n        }\n      }\n      pageInfo {\n        hasNextPage\n      }\n    }\n  }\n": types.GetArweaveTransactionsDocument,
    "\n  query GetImageSeeds($where: AttestationWhereInput!) {\n    imageSeeds: attestations(where: $where, orderBy: [{ timeCreated: desc }]) {\n      id\n      decodedDataJson\n      attester\n      schema {\n        schemaNames {\n          name\n        }\n      }\n      refUID\n      revoked\n      schemaId\n      txid\n      timeCreated\n      time\n      isOffchain\n    }\n  }\n": types.GetImageSeedsDocument,
    "\n  query GetImageVersions($where: AttestationWhereInput!) {\n    imageVersions: attestations(\n      where: $where\n      orderBy: [{ timeCreated: desc }]\n    ) {\n      ...attestationFields\n    }\n  }\n": types.GetImageVersionsDocument,
    "\n  query GetSchemaUids($where: SchemaWhereInput!) {\n    schemaUids: schemata(where: $where) {\n      id\n      schema\n      schemaNames {\n        name\n      }\n    }\n  }\n": types.GetSchemaUidsDocument,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 *
 *
 * @example
 * ```ts
 * const query = graphql(`query GetUser($id: ID!) { user(id: $id) { name } }`);
 * ```
 *
 * The query argument is unknown!
 * Please regenerate the types.
 */
export function graphql(source: string): unknown;

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query GetTransactionTags($transactionId: ID!) {\n    tags: transaction(id: $transactionId) {\n      id\n      tags {\n        name\n        value\n      }\n    }\n  }\n"): (typeof documents)["\n  query GetTransactionTags($transactionId: ID!) {\n    tags: transaction(id: $transactionId) {\n      id\n      tags {\n        name\n        value\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment attestationFields on Attestation {\n    id\n    decodedDataJson\n    attester\n    schema {\n      schemaNames {\n        name\n      }\n    }\n    refUID\n    revoked\n    schemaId\n    txid\n    timeCreated\n    time\n    isOffchain\n  }\n"): (typeof documents)["\n  fragment attestationFields on Attestation {\n    id\n    decodedDataJson\n    attester\n    schema {\n      schemaNames {\n        name\n      }\n    }\n    refUID\n    revoked\n    schemaId\n    txid\n    timeCreated\n    time\n    isOffchain\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment schemaFields on Schema {\n    id\n    resolver\n    revocable\n    schema\n    index\n    schemaNames {\n      name\n    }\n    time\n    txid\n    creator\n  }\n"): (typeof documents)["\n  fragment schemaFields on Schema {\n    id\n    resolver\n    revocable\n    schema\n    index\n    schemaNames {\n      name\n    }\n    time\n    txid\n    creator\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query GetSchemas($where: SchemaWhereInput!) {\n    schemas: schemata(where: $where) {\n      id\n      schema\n      schemaNames {\n        name\n      }\n    }\n  }\n"): (typeof documents)["\n  query GetSchemas($where: SchemaWhereInput!) {\n    schemas: schemata(where: $where) {\n      id\n      schema\n      schemaNames {\n        name\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query GetSeeds($where: AttestationWhereInput!) {\n    itemSeeds: attestations(where: $where, orderBy: [{ timeCreated: desc }]) {\n      id\n      decodedDataJson\n      attester\n      schema {\n        schemaNames {\n          name\n        }\n      }\n      refUID\n      revoked\n      schemaId\n      timeCreated\n      isOffchain\n    }\n  }\n"): (typeof documents)["\n  query GetSeeds($where: AttestationWhereInput!) {\n    itemSeeds: attestations(where: $where, orderBy: [{ timeCreated: desc }]) {\n      id\n      decodedDataJson\n      attester\n      schema {\n        schemaNames {\n          name\n        }\n      }\n      refUID\n      revoked\n      schemaId\n      timeCreated\n      isOffchain\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query GetSeedIds($where: AttestationWhereInput!) {\n    itemSeedIds: attestations(where: $where, orderBy: [{ timeCreated: desc }]) {\n      id\n    }\n  }\n"): (typeof documents)["\n  query GetSeedIds($where: AttestationWhereInput!) {\n    itemSeedIds: attestations(where: $where, orderBy: [{ timeCreated: desc }]) {\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query GetStorageTransactionId($where: AttestationWhereInput!) {\n    storageTransactionId: attestations(\n      where: $where\n      orderBy: [{ timeCreated: desc }]\n    ) {\n      id\n      decodedDataJson\n    }\n  }\n"): (typeof documents)["\n  query GetStorageTransactionId($where: AttestationWhereInput!) {\n    storageTransactionId: attestations(\n      where: $where\n      orderBy: [{ timeCreated: desc }]\n    ) {\n      id\n      decodedDataJson\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query GetVersions($where: AttestationWhereInput!) {\n    itemVersions: attestations(\n      where: $where\n      orderBy: [{ timeCreated: desc }]\n    ) {\n      ...attestationFields\n    }\n  }\n"): (typeof documents)["\n  query GetVersions($where: AttestationWhereInput!) {\n    itemVersions: attestations(\n      where: $where\n      orderBy: [{ timeCreated: desc }]\n    ) {\n      ...attestationFields\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query GetProperties($where: AttestationWhereInput!) {\n    itemProperties: attestations(\n      where: $where\n      orderBy: [{ timeCreated: desc }]\n    ) {\n      ...attestationFields\n    }\n  }\n"): (typeof documents)["\n  query GetProperties($where: AttestationWhereInput!) {\n    itemProperties: attestations(\n      where: $where\n      orderBy: [{ timeCreated: desc }]\n    ) {\n      ...attestationFields\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query GetAllPropertiesForAllVersions($where: AttestationWhereInput!) {\n    allProperties: attestations(\n      where: $where\n      orderBy: [{ timeCreated: desc }]\n    ) {\n      ...attestationFields\n    }\n  }\n"): (typeof documents)["\n  query GetAllPropertiesForAllVersions($where: AttestationWhereInput!) {\n    allProperties: attestations(\n      where: $where\n      orderBy: [{ timeCreated: desc }]\n    ) {\n      ...attestationFields\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query GetFilesMetadata($where: AttestationWhereInput!) {\n    filesMetadata: attestations(\n      where: $where\n      orderBy: [{ timeCreated: desc }]\n    ) {\n      ...attestationFields\n    }\n  }\n"): (typeof documents)["\n  query GetFilesMetadata($where: AttestationWhereInput!) {\n    filesMetadata: attestations(\n      where: $where\n      orderBy: [{ timeCreated: desc }]\n    ) {\n      ...attestationFields\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query GetArweaveTransactions(\n    $owners: [String!]\n    $first: Int\n    $after: String\n  ) {\n    transactions(owners: $owners, first: $first, after: $after) {\n      edges {\n        cursor\n        node {\n          id\n          anchor\n          signature\n          block {\n            id\n            height\n          }\n          data {\n            size\n            type\n          }\n          tags {\n            name\n            value\n          }\n        }\n      }\n      pageInfo {\n        hasNextPage\n      }\n    }\n  }\n"): (typeof documents)["\n  query GetArweaveTransactions(\n    $owners: [String!]\n    $first: Int\n    $after: String\n  ) {\n    transactions(owners: $owners, first: $first, after: $after) {\n      edges {\n        cursor\n        node {\n          id\n          anchor\n          signature\n          block {\n            id\n            height\n          }\n          data {\n            size\n            type\n          }\n          tags {\n            name\n            value\n          }\n        }\n      }\n      pageInfo {\n        hasNextPage\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query GetImageSeeds($where: AttestationWhereInput!) {\n    imageSeeds: attestations(where: $where, orderBy: [{ timeCreated: desc }]) {\n      id\n      decodedDataJson\n      attester\n      schema {\n        schemaNames {\n          name\n        }\n      }\n      refUID\n      revoked\n      schemaId\n      txid\n      timeCreated\n      time\n      isOffchain\n    }\n  }\n"): (typeof documents)["\n  query GetImageSeeds($where: AttestationWhereInput!) {\n    imageSeeds: attestations(where: $where, orderBy: [{ timeCreated: desc }]) {\n      id\n      decodedDataJson\n      attester\n      schema {\n        schemaNames {\n          name\n        }\n      }\n      refUID\n      revoked\n      schemaId\n      txid\n      timeCreated\n      time\n      isOffchain\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query GetImageVersions($where: AttestationWhereInput!) {\n    imageVersions: attestations(\n      where: $where\n      orderBy: [{ timeCreated: desc }]\n    ) {\n      ...attestationFields\n    }\n  }\n"): (typeof documents)["\n  query GetImageVersions($where: AttestationWhereInput!) {\n    imageVersions: attestations(\n      where: $where\n      orderBy: [{ timeCreated: desc }]\n    ) {\n      ...attestationFields\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query GetSchemaUids($where: SchemaWhereInput!) {\n    schemaUids: schemata(where: $where) {\n      id\n      schema\n      schemaNames {\n        name\n      }\n    }\n  }\n"): (typeof documents)["\n  query GetSchemaUids($where: SchemaWhereInput!) {\n    schemaUids: schemata(where: $where) {\n      id\n      schema\n      schemaNames {\n        name\n      }\n    }\n  }\n"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;
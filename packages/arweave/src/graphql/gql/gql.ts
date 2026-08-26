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
type Documents = {
    "\n  query GetTransactionTags($transactionId: ID!) {\n    tags: transaction(id: $transactionId) {\n      id\n      tags {\n        name\n        value\n      }\n    }\n  }\n": typeof types.GetTransactionTagsDocument,
    "\n  query GetArweaveTransactions(\n    $owners: [String!]\n    $first: Int\n    $after: String\n  ) {\n    transactions(owners: $owners, first: $first, after: $after) {\n      edges {\n        cursor\n        node {\n          id\n          anchor\n          signature\n          block {\n            id\n            height\n          }\n          data {\n            size\n            type\n          }\n          tags {\n            name\n            value\n          }\n        }\n      }\n      pageInfo {\n        hasNextPage\n      }\n    }\n  }\n": typeof types.GetArweaveTransactionsDocument,
};
const documents: Documents = {
    "\n  query GetTransactionTags($transactionId: ID!) {\n    tags: transaction(id: $transactionId) {\n      id\n      tags {\n        name\n        value\n      }\n    }\n  }\n": types.GetTransactionTagsDocument,
    "\n  query GetArweaveTransactions(\n    $owners: [String!]\n    $first: Int\n    $after: String\n  ) {\n    transactions(owners: $owners, first: $first, after: $after) {\n      edges {\n        cursor\n        node {\n          id\n          anchor\n          signature\n          block {\n            id\n            height\n          }\n          data {\n            size\n            type\n          }\n          tags {\n            name\n            value\n          }\n        }\n      }\n      pageInfo {\n        hasNextPage\n      }\n    }\n  }\n": types.GetArweaveTransactionsDocument,
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
export function graphql(source: "\n  query GetArweaveTransactions(\n    $owners: [String!]\n    $first: Int\n    $after: String\n  ) {\n    transactions(owners: $owners, first: $first, after: $after) {\n      edges {\n        cursor\n        node {\n          id\n          anchor\n          signature\n          block {\n            id\n            height\n          }\n          data {\n            size\n            type\n          }\n          tags {\n            name\n            value\n          }\n        }\n      }\n      pageInfo {\n        hasNextPage\n      }\n    }\n  }\n"): (typeof documents)["\n  query GetArweaveTransactions(\n    $owners: [String!]\n    $first: Int\n    $after: String\n  ) {\n    transactions(owners: $owners, first: $first, after: $after) {\n      edges {\n        cursor\n        node {\n          id\n          anchor\n          signature\n          block {\n            id\n            height\n          }\n          data {\n            size\n            type\n          }\n          tags {\n            name\n            value\n          }\n        }\n      }\n      pageInfo {\n        hasNextPage\n      }\n    }\n  }\n"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;
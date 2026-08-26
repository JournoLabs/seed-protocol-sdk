/* eslint-disable */
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type Maybe<T> = T | null;
export type InputMaybe<T> = T | null | undefined;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
};

/** Representation of a value transfer between wallets, in both winson and ar. */
export type Amount = {
  __typename?: 'Amount';
  /** Amount as an AR string e.g. \`"0.000000000001"\`. */
  ar: Scalars['String']['output'];
  /** Amount as a winston string e.g. \`"1000000000000"\`. */
  winston: Scalars['String']['output'];
};

/** Block Schema */
export type Block = {
  __typename?: 'Block';
  /** The block height. */
  height: Scalars['Int']['output'];
  /** The block ID. */
  id?: Maybe<Scalars['ID']['output']>;
  /** The previous block ID. */
  previous?: Maybe<Scalars['ID']['output']>;
  /** The block timestamp (UTC). */
  timestamp?: Maybe<Scalars['Int']['output']>;
};

/**
 * Paginated result set using the GraphQL cursor spec,
 * see: https://relay.dev/graphql/connections.htm.
 */
export type BlockConnection = {
  __typename?: 'BlockConnection';
  edges: Array<BlockEdge>;
  pageInfo: PageInfo;
};

/** Paginated result set using the GraphQL cursor spec. */
export type BlockEdge = {
  __typename?: 'BlockEdge';
  /**
   * The cursor value for fetching the next page.
   *
   * Pass this to the after parameter in blocks(after: $cursor), the next page will start from the next item after this.
   */
  cursor: Scalars['String']['output'];
  /** A block object. */
  node: Block;
};

/**
 * The data bundle containing the current data item.
 * See: https://github.com/ArweaveTeam/arweave-standards/blob/master/ans/ANS-104.md.
 */
export type Bundle = {
  __typename?: 'Bundle';
  /** ID of the containing data bundle. */
  id: Scalars['ID']['output'];
};

export enum CacheControlScope {
  Private = 'PRIVATE',
  Public = 'PUBLIC'
}

/** Basic metadata about the transaction data payload. */
export type MetaData = {
  __typename?: 'MetaData';
  /** Size of the associated data in bytes. */
  size: Scalars['String']['output'];
  /** Type is derived from the \`content-type\` tag on a transaction. */
  type?: Maybe<Scalars['String']['output']>;
};

/** Representation of a transaction owner. */
export type Owner = {
  __typename?: 'Owner';
  /** The owner's wallet address. */
  address: Scalars['String']['output'];
  /** The owner's public key as a base64url encoded string. */
  key: Scalars['String']['output'];
};

/** Paginated page info using the GraphQL cursor spec. */
export type PageInfo = {
  __typename?: 'PageInfo';
  hasNextPage: Scalars['Boolean']['output'];
};

/**
 * The parent transaction for bundled transactions,
 * see: https://github.com/ArweaveTeam/arweave-standards/blob/master/ans/ANS-102.md.
 */
export type Parent = {
  __typename?: 'Parent';
  id: Scalars['ID']['output'];
};

export type Query = {
  __typename?: 'Query';
  block?: Maybe<Block>;
  blocks: BlockConnection;
  /** Get a transaction by its id */
  transaction?: Maybe<Transaction>;
  /** Get a paginated set of matching transactions using filters. */
  transactions: TransactionConnection;
};


export type QueryBlockArgs = {
  id?: InputMaybe<Scalars['String']['input']>;
};


export type QueryBlocksArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  height?: InputMaybe<RangeFilter>;
  ids?: InputMaybe<Array<Scalars['ID']['input']>>;
  sort?: InputMaybe<SortOrder>;
};


export type QueryTransactionArgs = {
  id: Scalars['ID']['input'];
};


export type QueryTransactionsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  block?: InputMaybe<RangeFilter>;
  bundledIn?: InputMaybe<Array<Scalars['ID']['input']>>;
  first?: InputMaybe<Scalars['Int']['input']>;
  ids?: InputMaybe<Array<Scalars['ID']['input']>>;
  ingested_at?: InputMaybe<RangeFilter>;
  owners?: InputMaybe<Array<Scalars['String']['input']>>;
  recipients?: InputMaybe<Array<Scalars['String']['input']>>;
  sort?: InputMaybe<SortOrder>;
  tags?: InputMaybe<Array<TagFilter>>;
};

/** Filter with a min and max */
export type RangeFilter = {
  /** Maximum integer to filter to */
  max?: InputMaybe<Scalars['Int']['input']>;
  /** Minimum integer to filter from */
  min?: InputMaybe<Scalars['Int']['input']>;
};

/** Optionally reverse the result sort order from `HEIGHT_DESC` (default) to `HEIGHT_ASC`. */
export enum SortOrder {
  /** Results are sorted by the transaction block height in ascending order, with the oldest transactions appearing first, and the most recent and pending/unconfirmed appearing last. */
  HeightAsc = 'HEIGHT_ASC',
  /** Results are sorted by the transaction block height in descending order, with the most recent and unconfirmed/pending transactions appearing first. */
  HeightDesc = 'HEIGHT_DESC',
  /** Results are sorted by the transaction ingestion time in ascending order, with the oldest ingested transactions appearing first. */
  IngestedAtAsc = 'INGESTED_AT_ASC',
  /** Results are sorted by the transaction ingestion time in descending order, with the most recently ingested transactions appearing first. */
  IngestedAtDesc = 'INGESTED_AT_DESC'
}

/** Tag Schema */
export type Tag = {
  __typename?: 'Tag';
  /** UTF-8 tag name */
  name: Scalars['String']['output'];
  /** UTF-8 tag value */
  value: Scalars['String']['output'];
};

/** Find transactions with the following tag name and value */
export type TagFilter = {
  /** How tag names and values are matched. Defaults to EXACT. */
  match?: TagMatch;
  /** The tag name */
  name?: InputMaybe<Scalars['String']['input']>;
  /** The operator to apply to to the tag filter. Defaults to EQ (equal). */
  op?: TagOperator;
  /**
   * An array of values to match against. If multiple values are passed then transactions with _any_ matching tag value from the set will be returned.
   *
   * e.g.
   *
   * `{name: "app-name", values: ["app-1"]}`
   *
   * Returns all transactions where the `app-name` tag has a value of `app-1`.
   *
   * `{name: "app-name", values: ["app-1", "app-2", "app-3"]}`
   *
   * Returns all transactions where the `app-name` tag has a value of either `app-1` _or_ `app-2` _or_ `app-3`.
   */
  values?: InputMaybe<Array<Scalars['String']['input']>>;
};

/** The method used to determine if tags match. */
export enum TagMatch {
  /** An exact match */
  Exact = 'EXACT',
  /** Fuzzy match containing all search terms */
  FuzzyAnd = 'FUZZY_AND',
  /** Fuzzy match containing at least one search term */
  FuzzyOr = 'FUZZY_OR',
  /** A wildcard match */
  Wildcard = 'WILDCARD'
}

/** The operator to apply to a tag value. */
export enum TagOperator {
  /** Equal */
  Eq = 'EQ',
  /** Not equal */
  Neq = 'NEQ'
}

/** Transaction Structure */
export type Transaction = {
  __typename?: 'Transaction';
  anchor: Scalars['String']['output'];
  /** Transactions with a null block are recent and unconfirmed, if they aren't mined into a block within 60 minutes they will be removed from results. */
  block?: Maybe<Block>;
  /**
   * For bundled data items this references the containing bundle ID.
   * See: https://github.com/ArweaveTeam/arweave-standards/blob/master/ans/ANS-104.md
   */
  bundledIn?: Maybe<Bundle>;
  data: MetaData;
  fee: Amount;
  id: Scalars['ID']['output'];
  /** When this transaction was made available for querying */
  ingested_at?: Maybe<Scalars['Int']['output']>;
  owner: Owner;
  /**
   * @deprecated Don't use, kept for backwards compatability only!
   * @deprecated Use `bundledIn`
   */
  parent?: Maybe<Parent>;
  quantity: Amount;
  recipient: Scalars['String']['output'];
  signature: Scalars['String']['output'];
  tags: Array<Tag>;
};

/**
 * Paginated result set using the GraphQL cursor spec,
 * see: https://relay.dev/graphql/connections.htm.
 */
export type TransactionConnection = {
  __typename?: 'TransactionConnection';
  /** The number of transactions that match this query. */
  count?: Maybe<Scalars['String']['output']>;
  edges: Array<TransactionEdge>;
  pageInfo: PageInfo;
};

/** Paginated result set using the GraphQL cursor spec. */
export type TransactionEdge = {
  __typename?: 'TransactionEdge';
  /**
   * The cursor value for fetching the next page.
   *
   * Pass this to the `after` parameter in ` transactions(after: $cursor)`, the next page will start from the next item after this.
   */
  cursor: Scalars['String']['output'];
  /** A transaction object. */
  node: Transaction;
};

export type GetTransactionTagsQueryVariables = Exact<{
  transactionId: Scalars['ID']['input'];
}>;


export type GetTransactionTagsQuery = { __typename?: 'Query', tags?: { __typename?: 'Transaction', id: string, tags: Array<{ __typename?: 'Tag', name: string, value: string }> } | null };

export type GetArweaveTransactionsQueryVariables = Exact<{
  owners?: InputMaybe<Array<Scalars['String']['input']> | Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  after?: InputMaybe<Scalars['String']['input']>;
}>;


export type GetArweaveTransactionsQuery = { __typename?: 'Query', transactions: { __typename?: 'TransactionConnection', edges: Array<{ __typename?: 'TransactionEdge', cursor: string, node: { __typename?: 'Transaction', id: string, anchor: string, signature: string, block?: { __typename?: 'Block', id?: string | null, height: number } | null, data: { __typename?: 'MetaData', size: string, type?: string | null }, tags: Array<{ __typename?: 'Tag', name: string, value: string }> } }>, pageInfo: { __typename?: 'PageInfo', hasNextPage: boolean } } };


export const GetTransactionTagsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetTransactionTags"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"transactionId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"tags"},"name":{"kind":"Name","value":"transaction"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"transactionId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tags"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"value"}}]}}]}}]}}]} as unknown as DocumentNode<GetTransactionTagsQuery, GetTransactionTagsQueryVariables>;
export const GetArweaveTransactionsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetArweaveTransactions"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"owners"}},"type":{"kind":"ListType","type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"first"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"after"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"transactions"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"owners"},"value":{"kind":"Variable","name":{"kind":"Name","value":"owners"}}},{"kind":"Argument","name":{"kind":"Name","value":"first"},"value":{"kind":"Variable","name":{"kind":"Name","value":"first"}}},{"kind":"Argument","name":{"kind":"Name","value":"after"},"value":{"kind":"Variable","name":{"kind":"Name","value":"after"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"edges"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cursor"}},{"kind":"Field","name":{"kind":"Name","value":"node"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"anchor"}},{"kind":"Field","name":{"kind":"Name","value":"signature"}},{"kind":"Field","name":{"kind":"Name","value":"block"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"height"}}]}},{"kind":"Field","name":{"kind":"Name","value":"data"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"type"}}]}},{"kind":"Field","name":{"kind":"Name","value":"tags"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"value"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"pageInfo"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"hasNextPage"}}]}}]}}]}}]} as unknown as DocumentNode<GetArweaveTransactionsQuery, GetArweaveTransactionsQueryVariables>;
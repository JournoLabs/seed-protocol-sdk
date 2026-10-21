
import type { Model } from '@/Model/Model'
import type { MultiTabMode } from '@/helpers/tabCoordinator'

export * from './db'
export * from './model'
export * from './item'
export * from './property'
export * from './machines'
export * from './arweave'
export * from './publish'

export * from './gateway'

export type Endpoints = {
  filePaths: string
  files: string
}

/** Where the Node SQLite database lives (`config.dbConfig`). The browser keeps its database in OPFS and ignores it. */
export interface DbConfig {
  /** libsql URL or file path for the database. Default: `<filesDir>/db/seed.db`. */
  dbUrl?: string
  /** @deprecated Unused — schema is the static SDK seedSchema + prebuilt SQL migrations */
  schemaDir?: string
  /** Directory the SDK's migration SQL is copied to and run from. Default: `<filesDir>/db`. */
  outDir?: string
}

export interface SeedConfig {
  /**
   * Persisted file path labels, saved in `app_state`. Both fields default to `filesDir`, and
   * `files` is the fallback for `filesDir`. Nothing else reads them, so most apps leave them out.
   */
  readonly endpoints?: Endpoints
  models?: Record<string, Model>
  arweaveDomain?: string
  /** Upload API origin (HTTP / hybrid fallback). */
  uploadApiBaseUrl?: string
  /** Gateway + upload transport (`http-gateway` default). */
  gateway?: import('./gateway').SeedGatewayConfig
  /**
   * EAS chain the SDK reads from (sync, schema lookups). Defaults to Optimism Sepolia, or to
   * `PublishConfig.chain` when `@seedprotocol/publish` is initialized. Must match the publish chain.
   */
  eas?: {
    /** Chain id. Known chains (`EAS_CHAIN_DEPLOYMENTS`) resolve their easscan indexer automatically. */
    chainId?: number
    /** EAS indexer GraphQL endpoint. Overrides the chain default and the `EAS_ENDPOINT` env var. */
    indexerUrl?: string
  }
  /**
   * Directory for the database and files: in OPFS in the browser, under `<cwd>/.seed` on Node when
   * relative. Default: `endpoints.files`, then `'.seed'`.
   */
  filesDir?: string
  dbConfig?: DbConfig
  /**
   * Path to schema JSON file (e.g. 'schema.json'). Node: relative to process.cwd(); Browser: relative to working dir.
   * `client.init` rejects if the file cannot be read or imported.
   */
  schemaFile?: string
  /**
   * Single canonical schema for the app. When provided:
   * - Loaded automatically at init (no separate import needed)
   * - Always applied on each app start (add/update models & properties)
   * - No "already exists with different content" errors
   * - `client.init` rejects if it cannot be read or applied
   * - string: path to schema file (Node: relative to process.cwd(); Browser: relative to working dir)
   * - object: the schema itself; only `metadata.name` and `models` are required
   */
  schema?: string | import('./import').SchemaFileInput
}

/**
 * Address configuration for owned vs watched wallets.
 * - owned: addresses the user controls (EOA + smart/managed account). Persisted lowercased.
 * - watched: addresses to browse (read-only, sync from EAS)
 *
 * `owned` is not the publisher stamp. New seeds are stamped with the publish
 * session `publisherAddress` (usually the managed account). Extra EAS indexers
 * belong in `setAdditionalSyncAddresses`, not `owned`.
 *
 * Legacy: string[] is treated as owned only.
 */
export type AddressConfiguration =
  | { owned: string[]; watched?: string[] }
  | string[]

export interface SeedConstructorOptions {
  config: SeedConfig
  /**
   * Addresses to save at init. Leave it out to keep the addresses already stored (the
   * SDK warns once when it does). Pass `[]` (or `{ owned: [] }`) to clear them, e.g.
   * before a wallet connects. In a second tab, `[]` keeps the first tab's addresses
   * (docs/MULTI_TAB.md). Calling init again with only different addresses applies them
   * like `client.setAddresses`.
   */
  readonly addresses?: AddressConfiguration
  /**
   * When true, after `setAddresses` persists to app_state, the SDK runs `runSyncFromEas`
   * immediately via the EAS sync orchestrator. Defaults to true so local
   * metadata hydrates after connect or an empty DB; set false to opt out or if you call
   * `syncFromEas` yourself.
   */
  readonly syncFromEasOnAddressChange?: boolean
  /**
   * How tabs of the same app share background work (browser only; see docs/MULTI_TAB.md).
   * `'coordinate'` (default) elects one leader tab to run automatic EAS sync, bulk file downloads
   * and the Arweave L1 finalize worker; `'off'` runs them in every tab.
   */
  readonly multiTab?: MultiTabMode
}

/**
 * Options for Entity.create() when default behavior is to wait until idle.
 * waitForReady defaults to true; pass { waitForReady: false } for sync return.
 */
export interface CreateWaitOptions {
  waitForReady?: boolean
  readyTimeout?: number
}

export interface ItemCreateOptions extends CreateWaitOptions {
  /**
   * Item.create rejects unknown keys and values that break their property's type or rules
   * (ItemCreateValidationError). Pass false only to import data that is already stored or
   * attested as-is; the values are then written unchecked.
   */
  validate?: boolean
}

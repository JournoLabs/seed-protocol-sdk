
import type { Model } from '@/Model/Model'
import type { MultiTabMode } from '@/helpers/tabCoordinator'

export * from './db'
export * from './model'
export * from './item'
export * from './property'
export * from './machines'
export * from './seedProtocol'
export * from './browser'
export * from './arweave'
export * from './publish'

export * from './gateway'

export type Endpoints = {
  filePaths: string
  files: string
}

export interface WebpackConfigContext {
  dir: string
  dev: boolean
  isServer: boolean
  buildId: string
  config: any
  defaultLoaders: {
    babel: any
  }
  totalPages: number
  webpack: any
  nextRuntime?: 'nodejs' | 'edge'
}


export type Environment = 'browser' | 'node' | 'react-native'


export interface DbConfig {
  dbUrl?: string
  schemaDir?: string
  outDir?: string
}

export interface SeedConfig {
  /**
   * Persisted file path labels. On Node, both fields default to `filesDir` when omitted.
   * Browser init still requires them.
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
  filesDir?: string
  dbConfig?: DbConfig
  /** Path to schema JSON file (e.g. 'schema.json'). Node: relative to process.cwd(); Browser: relative to working dir */
  schemaFile?: string
  /**
   * Single canonical schema for the app. When provided:
   * - Loaded automatically at init (no separate import needed)
   * - Always applied on each app start (add/update models & properties)
   * - No "already exists with different content" errors
   * - string: path to schema file (Node: relative to process.cwd(); Browser: relative to working dir)
   * - object: complete SchemaFileFormat inlined
   */
  schema?: string | import('./import').SchemaFileFormat
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
  readonly addresses?: AddressConfiguration
  /**
   * When true, after `setAddresses` persists to app_state, the SDK runs `runSyncFromEas`
   * immediately via the EAS sync orchestrator (not only the `syncDbWithEas` event listener). Defaults to true so local
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

export type ClientCallback = (event: any) => void

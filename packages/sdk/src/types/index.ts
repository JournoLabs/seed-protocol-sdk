
import type { Model } from '@/Model/Model'

export * from './db'
export * from './model'
export * from './item'
export * from './property'
export * from './machines'
export * from './seedProtocol'
export * from './browser'
export * from './arweave'
export * from './publish'

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
  readonly endpoints: Endpoints
  models?: Record<string, Model>
  arweaveDomain?: string
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
 * - owned: addresses the user controls (create, edit, publish)
 * - watched: addresses to browse (read-only, sync from EAS)
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
   * immediately (not via the throttled `syncDbWithEas` listener). Default false preserves
   * prior behavior; apps that already call `syncFromEas` can omit this.
   */
  readonly syncFromEasOnAddressChange?: boolean
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

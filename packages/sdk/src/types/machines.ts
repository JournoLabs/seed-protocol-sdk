import { Endpoints } from './index'
import { SchemaFileFormat } from './import'
import type { Model } from '@/Model/Model'

// InternalMachineContext removed - functionality moved to ClientManager
// DbServiceContext removed - dbMachine and db service have been removed

export type FromCallbackInput<T, P = undefined> = {
  context: T
  event?: P
}

/**
 * Why the client stopped: `'stop'` for `client.stop()` or `client.unload()`, `'reset'` when
 * `client.resetLocalData()` in this tab or another tab of the same database stopped it.
 */
export type ClientStopReason = 'stop' | 'reset'

export type ClientManagerContext = {
  isInitialized: boolean
  addressesSet: boolean
  isSaving: boolean
  /** When true, successful save of app_state key `addresses` triggers an EAS sync via the orchestrator. */
  syncFromEasOnAddressChange?: boolean
  endpoints?: Endpoints
  addresses?: string[]
  /** False when init was called without `addresses`: stored addresses are kept. */
  addressesProvided?: boolean
  ownedAddresses?: string[]
  watchedAddresses?: string[]
  models?: { [key: string]: Model }
  schemas?: { [schemaName: string]: SchemaFileFormat }
  arweaveDomain?: string
  uploadApiBaseUrl?: string
  gatewayTransport?: import('@seedprotocol/arweave').SeedGatewayTransportMode
  gatewayHyperKey?: string
  gatewaySidecarHost?: string
  gatewaySidecarPort?: number
  gatewayProxyBaseUrl?: string
  filesDir?: string
  dbConfig?: import('@/types').DbConfig
  schemaFile?: string
  schema?: string | SchemaFileFormat
  initError?: Error | string
  saveError?: Error | string
  /** Set as the client stops; read it once the snapshot's `status` is `'stopped'`. */
  stopReason?: ClientStopReason
}

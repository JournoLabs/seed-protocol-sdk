import {
  assertSingleArweaveModule,
  BaseArweaveClient,
  DEFAULT_ARWEAVE_HOST,
  resolveArweaveHostFromEnv,
} from '@seedprotocol/arweave'
import { assertSingleEasModule, BaseEasClient, ensureEasPlatform } from '@seedprotocol/eas'
import { setQueryModels, type QueryModels } from './queryModels.js'
import type { QuerySourceMode } from './types.js'

let initialized = false

export type InitializeQueryPlatformOptions = {
  arweaveDomain?: string
  /**
   * The source the call reads from. `'local'` skips the DuplicateEasModuleError /
   * DuplicateArweaveModuleError checks, since a local read uses neither client.
   */
  source?: QuerySourceMode
  /**
   * Your schema file's `models`, so List relations come back under their schema keys
   * (`coAuthors`, not `cos`; see `setQueryModels`). Kept until set again; `null` clears it.
   */
  models?: QueryModels | null
}

/** Fills in Arweave for a process where nothing has registered an Arweave client. */
export type QueryArweavePlatformRegistrar = (options: { arweaveDomain: string }) => Promise<void>

/**
 * Browser default. Query only reads the gateway host from BaseArweaveClient, so no client is
 * registered; that is left to the SDK or the host app.
 */
const setPreferredReadGatewayOnly: QueryArweavePlatformRegistrar = async ({ arweaveDomain }) => {
  BaseArweaveClient.setPreferredReadGateway(arweaveDomain)
}

let registerArweavePlatform: QueryArweavePlatformRegistrar = setPreferredReadGatewayOnly

/**
 * @internal Set by the Node entries, which register the Node Arweave client when none is
 * configured. The browser entry keeps the default so its graph never loads `@seedprotocol/arweave/node`.
 */
export function configureQueryArweavePlatform(registrar: QueryArweavePlatformRegistrar): void {
  registerArweavePlatform = registrar
}

/** Fills in the EAS client for a process where nothing has registered one. */
export type QueryEasPlatformRegistrar = () => Promise<void>

/** Browser default: none here; ensureEasPlatform registers the default client. */
let registerEasPlatform: QueryEasPlatformRegistrar = async () => {}

/**
 * @internal Set by the Node entries, which register the Node EAS client (connection reuse and TLS
 * settings for the indexer; see `@seedprotocol/eas/node`) when none is configured.
 */
export function configureQueryEasPlatform(registrar: QueryEasPlatformRegistrar): void {
  registerEasPlatform = registrar
}

function resolveQueryArweaveDomain(explicit?: string): string {
  return explicit ?? resolveArweaveHostFromEnv() ?? DEFAULT_ARWEAVE_HOST
}

/**
 * Make sure EAS and Arweave are usable for remote query. Clients already registered (by the SDK
 * or a host app) are used as they are, so query can run in a page or process where SeedClient is
 * running without replacing its clients or its Arweave gateway. Only missing pieces get defaults.
 *
 * Throws DuplicateEasModuleError / DuplicateArweaveModuleError when the clients were registered
 * on another copy of those packages, unless `source` is `'local'`. Checked on every call, since the
 * SDK may register after query's first call.
 */
export async function initializeQueryPlatform(
  options?: InitializeQueryPlatformOptions,
): Promise<void> {
  if (options?.source !== 'local') {
    assertSingleEasModule()
    assertSingleArweaveModule()
  }
  if (options?.models !== undefined) setQueryModels(options.models)
  if (initialized) return
  if (!BaseEasClient.isConfigured()) await registerEasPlatform()
  ensureEasPlatform()
  if (!BaseArweaveClient.isConfigured()) {
    await registerArweavePlatform({
      arweaveDomain: resolveQueryArweaveDomain(options?.arweaveDomain),
    })
  }
  if (options?.arweaveDomain) {
    BaseArweaveClient.setHost(options.arweaveDomain)
  }
  initialized = true
}

export async function teardownQueryPlatform(): Promise<void> {
  initialized = false
  setQueryModels(null)
}

export function isQueryPlatformInitialized(): boolean {
  return initialized
}

export { DEFAULT_ARWEAVE_HOST } from '@seedprotocol/arweave'

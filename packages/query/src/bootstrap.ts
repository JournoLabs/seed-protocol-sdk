import {
  BaseArweaveClient,
  DEFAULT_ARWEAVE_HOST,
  resolveArweaveHostFromEnv,
} from '@seedprotocol/arweave'
import { ensureEasPlatform } from '@seedprotocol/eas'

let initialized = false

export type InitializeQueryPlatformOptions = {
  arweaveDomain?: string
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

function resolveQueryArweaveDomain(explicit?: string): string {
  return explicit ?? resolveArweaveHostFromEnv() ?? DEFAULT_ARWEAVE_HOST
}

/**
 * Make sure EAS and Arweave are usable for remote query. Clients already registered (by the SDK
 * or a host app) are used as they are, so query can run in a page or process where SeedClient is
 * running without replacing its clients or its Arweave gateway. Only missing pieces get defaults.
 */
export async function initializeQueryPlatform(
  options?: InitializeQueryPlatformOptions,
): Promise<void> {
  if (initialized) return
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
}

export function isQueryPlatformInitialized(): boolean {
  return initialized
}

export { DEFAULT_ARWEAVE_HOST } from '@seedprotocol/arweave'

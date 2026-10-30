import { ClientManagerContext, SeedConstructorOptions } from '@/types'
import debug                                       from 'debug'
import { setupAllItemsEventHandlers } from "@/events/item";
import { isBrowser, isNode } from "@/helpers/environment";
import {
  BaseArweaveClient,
  ensureReadGatewaySelected,
  resolveSeedGatewayEndpoints,
  seedGatewayConfigFromSeedConfig,
  setPreferredArweaveReadBaseUrls,
  setResolvedSeedGatewayEndpoints,
} from '@seedprotocol/arweave'
import { configureEasReadChain } from '@seedprotocol/eas'
import { normalizeAddressConfig } from '@/helpers/addresses'
import { applySeedConfigDefaults } from '../seedConfigDefaults'
import { holdDbOpenLock, startTabCoordination } from '@/helpers/tabCoordinator'

const logger = debug('seedSdk:ClientManager:initialize')

export type InitEvent = {
  type: 'init'
  options: SeedConstructorOptions
}


/**
 * The first init step: configures the platform services, EAS reads and the Arweave gateway from
 * the init options, starts tab coordination and the item event handlers, and returns the context
 * the following steps read.
 */
export async function platformClassesInit({ event }: { event: InitEvent }): Promise<Partial<ClientManagerContext>> {
  logger('initialize from ClientManager')
  if (!event || !('options' in event)) {
    throw new Error('Initialize event must include options')
  }
  const { options } = event
  const { addresses } = options
  const config = applySeedConfigDefaults(options.config)
  if (!config) {
    throw new Error('client.init requires a config')
  }

  const { configurePlatform } = await import('../../platform/configurePlatform')
  if (isBrowser()) {
    const { createPlatformServices } = await import('../../platform/index.browser')
    configurePlatform(createPlatformServices())
  } else if (isNode()) {
    // `#seed-node-platform` (package.json `imports`) maps to the browser platform under
    // the `browser` condition, so browser bundles never contain the Node platform
    // (libsql, node:fs). A relative import here would ship it to every browser app.
    const { createPlatformServices } = await import('#seed-node-platform')
    configurePlatform(createPlatformServices())
  } else {
    throw new Error(
      `Unable to determine environment. isBrowser()=${isBrowser()}, isNode()=${isNode()}. Platform-specific implementations could not be loaded.`,
    )
  }

  const { models, endpoints, arweaveDomain, dbConfig, filesDir, schemaFile, schema, gateway, uploadApiBaseUrl, eas } = config
  if (eas) {
    configureEasReadChain('sdk', { chainId: eas.chainId, indexerUrl: eas.indexerUrl })
  }
  const gatewayConfig = seedGatewayConfigFromSeedConfig({
    ...config,
    arweaveDomain,
    uploadApiBaseUrl,
    gateway,
  })
  // Only when configured, so a host app's own setPreferredArweaveReadBaseUrls() call survives init.
  if (gatewayConfig.preferredReadBaseUrls) {
    setPreferredArweaveReadBaseUrls(gatewayConfig.preferredReadBaseUrls)
  }
  const resolvedGateway = await resolveSeedGatewayEndpoints(gatewayConfig)
  setResolvedSeedGatewayEndpoints(resolvedGateway)
  BaseArweaveClient.setHost(`${resolvedGateway.arweaveProtocol}://${resolvedGateway.arweaveHost}`)

  // filesDir falls back to endpoints.files (applySeedConfigDefaults fills both)
  let normalizedFilesDir = filesDir || endpoints?.files
  // jsdom (and any env with both Node + window) is "browser" for SDK: filesDir is an OPFS path.
  // Do not run real fs against those paths (e.g. mkdir '/.seed').
  if (isNode() && !isBrowser() && normalizedFilesDir) {
    // Lives in the Node platform so browser bundles (and Next.js server builds, which
    // alias it to the browser platform) carry no fs code with computed paths.
    const { resolveFilesDir } = await import('#seed-node-platform')
    normalizedFilesDir = resolveFilesDir(normalizedFilesDir)
  }

  // Elect a leader tab for background work before anything requests it (docs/MULTI_TAB.md).
  if (normalizedFilesDir) {
    startTabCoordination({ filesDir: normalizedFilesDir, mode: options.multiTab })
    // Held until the database closes; waits while client.resetLocalData() deletes it.
    await holdDbOpenLock()
  }

  if (resolvedGateway.activePath !== 'hyper-sidecar' && resolvedGateway.activePath !== 'http-proxy') {
    void ensureReadGatewaySelected().catch(() => {
      /* non-blocking warm-up for read gateway probe */
    })
  }

  setupAllItemsEventHandlers()

  const normalizedAddresses = normalizeAddressConfig(addresses)
  return {
    models: models || {},
    endpoints,
    arweaveDomain: resolvedGateway.arweaveHost,
    uploadApiBaseUrl: resolvedGateway.uploadApiBaseUrl,
    gatewayTransport: resolvedGateway.mode,
    gatewayHyperKey: resolvedGateway.gatewayHyperKey,
    gatewaySidecarHost: gatewayConfig.hyper?.localSidecarHost,
    gatewaySidecarPort: gatewayConfig.hyper?.localSidecarPort,
    gatewayProxyBaseUrl: resolvedGateway.proxyBaseUrl ?? gatewayConfig.proxyBaseUrl,
    addresses: normalizedAddresses.owned,
    addressesProvided: addresses !== undefined,
    ownedAddresses: normalizedAddresses.owned,
    watchedAddresses: normalizedAddresses.watched,
    filesDir: normalizedFilesDir,
    dbConfig,
    schemaFile,
    // syncSchemaFromSource takes the forms SchemaFileInput allows
    schema: schema as ClientManagerContext['schema'],
    syncFromEasOnAddressChange: options.syncFromEasOnAddressChange ?? true,
  }
}

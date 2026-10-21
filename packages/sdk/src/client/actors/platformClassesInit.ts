import { ClientManagerContext, FromCallbackInput, SeedConstructorOptions } from '@/types'
import { fromCallback, EventObject }                      from "xstate";
import debug                                       from 'debug'
import { setupAllItemsEventHandlers } from "@/events/item";
// import { getGlobalService, } from "@/services/global/globalMachine";
import { isBrowser, isNode } from "@/helpers/environment";
import {
  BaseArweaveClient,
  ensureReadGatewaySelected,
  resolveSeedGatewayEndpoints,
  seedGatewayConfigFromSeedConfig,
  setResolvedSeedGatewayEndpoints,
} from "@/helpers";
import { setPreferredArweaveReadBaseUrls } from '@/helpers/gateway/gatewayState'
import { configureEasReadChain } from '@seedprotocol/eas'
import { normalizeAddressConfig } from '@/helpers/addresses'
import { applySeedConfigDefaults } from '../seedConfigDefaults'
import { startTabCoordination } from '@/helpers/tabCoordinator'

const logger = debug('seedSdk:ClientManager:initialize')

type InitEvent = {
  type: 'init'
  options: SeedConstructorOptions
}

export { isUnderDotSeed } from '@/helpers/dotSeedPath'

export const platformClassesInit = fromCallback<
EventObject, 
FromCallbackInput<ClientManagerContext, InitEvent>
>(({sendBack, input: {context, event}}) => {
  logger('initialize from ClientManager')
  const { isInitialized } = context
  
  if (!event || !('options' in event)) {
    throw new Error('Initialize event must include options')
  }
  
  const { options } = event

  if (isInitialized) {
    sendBack({type: 'initialized'})
    return
  }

  // Track if the operation is cancelled
  let cancelled = false

  // Create a promise that will handle validation errors immediately
  // We use Promise.resolve().then() to ensure the catch handler is attached synchronously
  // before the async function starts executing, preventing unhandled rejections
  const initPromise = Promise.resolve().then(async () => {
    // Check if cancelled before starting
    if (cancelled) {
      return
    }

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

    // Check if cancelled after async imports
    if (cancelled) {
      return
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

    const normalizedAddresses = normalizeAddressConfig(addresses)
    sendBack({ type: 'updateContext', context: { 
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
      schema,
      syncFromEasOnAddressChange: options.syncFromEasOnAddressChange ?? true,
    } })

    // Elect a leader tab for background work before anything requests it (docs/MULTI_TAB.md).
    if (normalizedFilesDir) {
      startTabCoordination({ filesDir: normalizedFilesDir, mode: options.multiTab })
    }

    if (resolvedGateway.activePath !== 'hyper-sidecar' && resolvedGateway.activePath !== 'http-proxy') {
      void ensureReadGatewaySelected().catch(() => {
        /* non-blocking warm-up for read gateway probe */
      })
    }

    // Models are now Model instances, no registration needed
    // They should be created via Model.create() and are accessible via Model static methods
    setupAllItemsEventHandlers()
  })

  // Handle the promise immediately - this ensures rejections are caught synchronously
  // The catch handler is attached synchronously before the async function executes
  initPromise
    .then(() => {
      if (!cancelled) {
        sendBack({type: 'platformClassesReady'})
      }
    })
    .catch((error) => {
      // Only send error if not cancelled (prevents unhandled rejections after cleanup)
      if (!cancelled) {
        // Send error event using sendBack - this is the recommended XState pattern
        // The parent state machine should handle the 'error' event
        sendBack({ 
          type: 'error', 
          error: error instanceof Error ? error : new Error(String(error))
        })
      }
      // Explicitly handle the rejection to prevent unhandled promise rejection warnings
      // The error has been sent via sendBack, so we've handled it
    })

  // Return cleanup function to cancel pending operations
  return () => {
    cancelled = true
    // The promise will still resolve/reject, but we won't send events if cancelled
    // This prevents unhandled rejections after the callback is cleaned up
  }
})

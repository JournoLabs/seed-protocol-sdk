import { ClientManagerContext, FromCallbackInput, SeedConstructorOptions } from '@/types'
import { fromCallback, EventObject, waitFor }                      from "xstate";
import debug                                       from 'debug'
import { setArweaveDomain } from "@/helpers/ArweaveClient";
import { setupServicesEventHandlers } from "@/services/events";
import { setupAllItemsEventHandlers } from "@/events/item";
import { setupServiceHandlers } from "@/events/services";
// import { getGlobalService, } from "@/services/global/globalMachine";
// import { GlobalState } from "@/client/constants";
import { isBrowser, isNode } from "@/helpers/environment";
import { BaseFileManager } from "@/helpers/FileManager/BaseFileManager";
import { BaseArweaveClient, BaseEasClient, BaseQueryClient } from "@/helpers";
import { BasePathResolver } from '@/helpers/PathResolver/BasePathResolver'
import { BaseDb } from '../../db/Db/BaseDb'
import { normalizeAddressConfig } from '@/helpers/addresses'

const logger = debug('seedSdk:ClientManager:initialize')

type InitEvent = {
  type: 'init'
  options: SeedConstructorOptions
}

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

  // Validate synchronously before starting async operations
  // This ensures errors are handled immediately, preventing unhandled rejections
  const { config } = options
  const { endpoints } = config || {}
  
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

    const { config, addresses } = options

    // Validate required endpoints - this should happen early in the initialization process
    if (!config?.endpoints || !config.endpoints.filePaths || !config.endpoints.files) {
      throw new Error('Config must include endpoints with filePaths and files')
    }

    let FileManager: typeof BaseFileManager
    let Db: typeof BaseDb
    let QueryClient: typeof BaseQueryClient
    let ArweaveClient: typeof BaseArweaveClient
    let PathResolver: typeof BasePathResolver
    let EasClient: typeof BaseEasClient

    if (isBrowser()) {
      FileManager = (await import('../../browser/helpers/FileManager')).FileManager
      Db = (await import('../../browser/db/Db')).Db
      QueryClient = (await import('../../browser/helpers/QueryClient')).QueryClient
      ArweaveClient = (await import('../../browser/helpers/ArweaveClient')).ArweaveClient
      PathResolver = (await import('../../browser/helpers/PathResolver')).PathResolver
      EasClient = (await import('../../browser/helpers/EasClient')).EasClient
    } else if (isNode()) {
      FileManager = (await import('../../node/helpers/FileManager')).FileManager
      Db = (await import('../../node/db/Db')).Db
      QueryClient = (await import('../../node/helpers/QueryClient')).QueryClient
      ArweaveClient = (await import('../../node/helpers/ArweaveClient')).ArweaveClient
      PathResolver = (await import('../../node/helpers/PathResolver')).PathResolver
      EasClient = (await import('../../node/helpers/EasClient')).EasClient
    } else {
      throw new Error(`Unable to determine environment. isBrowser()=${isBrowser()}, isNode()=${isNode()}. Platform-specific implementations could not be loaded.`)
    }
    
    if (!FileManager) {
      throw new Error('FileManager is undefined. Platform-specific FileManager could not be loaded.')
    }
    
    BaseFileManager.setPlatformClass(FileManager)
    BaseDb.setPlatformClass(Db!)
    BaseQueryClient.setPlatformClass(QueryClient!)
    BaseEasClient.setPlatformClass(EasClient!)
    BaseArweaveClient.setPlatformClass(ArweaveClient!)
    BasePathResolver.setPlatformClass(PathResolver!)

    // Check if cancelled after async imports
    if (cancelled) {
      return
    }
    
    const { models, endpoints, arweaveDomain, dbConfig, filesDir, schemaFile, schema } = config

    // Note: Validation already happened above, but we have endpoints here for path normalization

    // Normalize filesDir for Node.js environment
    // In Node.js, filesDir should be resolved relative to .seed directory at project root
    let normalizedFilesDir = filesDir || endpoints?.files
    // jsdom (and any env with both Node + window) is "browser" for SDK: PathResolver is OPFS/virtual.
    // Do not run real fs against those paths (e.g. mkdir '/.seed').
    if (isNode() && !isBrowser() && normalizedFilesDir) {
      const path = (await import('node:path')).default
      const fs = (await import('node:fs')).default
      const pathResolver = BasePathResolver.getInstance()
      const dotSeedDir = pathResolver.getDotSeedDir()
      
      // Ensure .seed directory exists
      if (!fs.existsSync(dotSeedDir)) {
        fs.mkdirSync(dotSeedDir, { recursive: true })
      }
      
      // Check if filesDir is a browser OPFS-style path (absolute path starting with '/'
      // that is a simple single-level path like '/app-files', not a real filesystem path)
      // Browser OPFS paths are typically simple like '/app-files', '/files', etc.
      const pathWithoutLeadingSlash = normalizedFilesDir.slice(1)
      const isBrowserOpfsPath = path.isAbsolute(normalizedFilesDir) && 
                                 normalizedFilesDir.startsWith('/') &&
                                 pathWithoutLeadingSlash.length > 0 &&
                                 !pathWithoutLeadingSlash.includes('/') && // Single directory name, no subdirectories
                                 !fs.existsSync(normalizedFilesDir) // Doesn't exist on filesystem
      
      if (isBrowserOpfsPath) {
        // Convert browser OPFS path to .seed subdirectory
        // e.g., '/app-files' -> '.seed/app-files'
        const dirName = normalizedFilesDir.slice(1) || 'app-files'
        normalizedFilesDir = path.join(dotSeedDir, dirName)
      } else if (!path.isAbsolute(normalizedFilesDir)) {
        // If it's a relative path, check if it already starts with .seed
        if (normalizedFilesDir.startsWith('.seed') || normalizedFilesDir.startsWith('.seed/')) {
          // Already relative to project root, resolve it
          normalizedFilesDir = path.resolve(normalizedFilesDir)
        } else {
          // Resolve relative to .seed directory
          normalizedFilesDir = path.join(dotSeedDir, normalizedFilesDir)
        }
      }
      // If it's an absolute path that exists or is a valid filesystem path, use it as-is
    }

    const normalizedAddresses = normalizeAddressConfig(addresses)
    sendBack({ type: 'updateContext', context: { 
      models: models || {}, 
      endpoints, 
      arweaveDomain, 
      addresses: normalizedAddresses.owned,
      ownedAddresses: normalizedAddresses.owned,
      watchedAddresses: normalizedAddresses.watched,
      filesDir: normalizedFilesDir,
      dbConfig,
      schemaFile,
      schema,
    } })
    
    if (arweaveDomain) {
      setArweaveDomain(arweaveDomain)
    }

    // Models are now Model instances, no registration needed
    // They should be created via Model.create() and are accessible via Model static methods
    setupAllItemsEventHandlers()
    setupServicesEventHandlers()
    setupServiceHandlers()
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

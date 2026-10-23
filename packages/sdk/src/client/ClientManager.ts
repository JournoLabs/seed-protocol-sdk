import type { AddressConfiguration, SeedConstructorOptions } from '@/types'
import { isEqual } from 'lodash-es'
import { normalizeAddressConfig } from '@/helpers/addresses'
import debug                      from 'debug'
import { createActor, waitFor }   from 'xstate'
import { clientManagerMachine }   from '@/client/clientManagerMachine'
// import { BaseDb }                 from '@/db/Db/BaseDb'
// import { appState }               from '@/seedSchema'
// import { eq }                     from 'drizzle-orm'
import { CLIENT_NOT_INITIALIZED } from '@/helpers/constants'
import { ClientManagerState } from '@/client/constants'
import { createCoalescedAsync } from '@/client/coalesceInit'
import { BaseDb }           from '@/db/Db/BaseDb'
import { inDefinitionsTransaction, insertModelStubs } from '@/db/write/definitions'
import {
  getOwnedAddressesFromDb,
  getWatchedAddressesFromDb,
} from '@/helpers/db'
import type { SyncFromEasOptions } from '@/events/item/syncDbWithEas'
import {
  easSyncActor,
  sendEasSyncClientRequest,
  startEasSyncActor,
} from '@/events/item/easSyncManager'
import {
  registerSeedQueryLocalSource,
  unregisterSeedQueryLocalSource,
} from '@/query/registerSeedQueryLocalSource'
import { LOCAL_COPIES_REMOVED_EVENT } from '@/client/events'
import { emitAcrossTabs } from '@/helpers/tabEvents'
import { resetAddressesPersistedAnnouncement } from '@/client/addressesPersisted'
import {
  findLocalOnchainCopiesForAddresses,
  hardDeleteLocalSeedsByLocalIds,
} from '@/db/write/removeLocalCopiesForAddresses'
import { claimUnpublishedDrafts } from '@/db/write/claimUnpublishedDrafts'
import { Item } from '@/Item/Item'
import { cancelAllRetriesWhenOnline } from '@/helpers/retryWhenOnline'
import { registerClientActor } from '@/client/readiness'
import { setEntityUnloadGraceMs } from '@/helpers/entity/entityCache'
import { ItemProperty } from '@/ItemProperty/ItemProperty'
import { Model } from '@/Model/Model'
import { ModelProperty } from '@/ModelProperty/ModelProperty'
import { Schema } from '@/Schema/Schema'
import { evictEntities } from '@/helpers/entity/entityLifecycle'
import { stopOutbox } from '@/outbox/outbox'
import { stopTabCoordination } from '@/helpers/tabCoordinator'
import { whenCanonicalizeModelTypesSettled } from '@/db/canonicalizeModelTypes'

const logger               = debug('seedSdk:client')

type ModelDefObj = {
  name: string
  type: string
  properties: {
    [key: string]: any
  }
}

const createClientManager = () => {
  const actor = createActor(clientManagerMachine, {
    input: {
      isInitialized: false,
      addressesSet: false,
      isSaving: false,
      syncFromEasOnAddressChange: false,
    }
  })
  const actorSubscription = actor.subscribe(( snapshot ) => {
    logger('ClientManager snapshot.value:', snapshot.value)
    logger('ClientManager snapshot.context.isInitialized:', snapshot.context.isInitialized)
  })
  actor.start()
  return { actor, actorSubscription }
}

// Replaced when init runs after stop(): an xstate actor can't be started again once stopped.
let { actor: clientManager, actorSubscription: subscription } = createClientManager()
export { clientManager }
registerClientActor(() => clientManager)

type ClientService = typeof clientManager
const serviceListeners = new Set<(service: ClientService) => void>()

/** Tells subscribeService listeners that the clientManager actor was replaced or stopped. */
const notifyServiceListeners = () => {
  for (const listener of [...serviceListeners]) {
    try {
      listener(clientManager)
    } catch (error) {
      logger('subscribeService listener threw:', error)
    }
  }
}

/** Config of the init that is running or has succeeded; cleared when init fails or the client stops. */
let activeInitConfig: SeedConstructorOptions['config'] | undefined

export const INIT_CONFIG_CONFLICT_MESSAGE =
  'client.init was already called with a different config. The SDK keeps the config it was ' +
  'initialised with: pass the same config, or call client.stop() before initialising with a new one. ' +
  'To change addresses, use client.setAddresses() (or call init again with the same config and new addresses).'

const ensureInitialized = () => {
  const snapshot = clientManager.getSnapshot()
  // After stop() the stopped actor's context still says isInitialized, so check its status too.
  if (snapshot.status !== 'active' || !snapshot.context.isInitialized) {
    throw new Error(CLIENT_NOT_INITIALIZED);
  }
}

export const CLIENT_ALREADY_STOPPED_WARNING =
  'client.stop() or client.unload() was called after the client had already stopped; this call does nothing. ' +
  'Remove the extra call, or call client.init() before stopping again.'

/** Set while a stop releases the client's resources; init waits for it. */
let stopping: Promise<void> | undefined

/**
 * Shared by stop() and unload(). Stops the client in any state, including after a failed or
 * unfinished init, then releases what it holds: the outbox drain, cached entities, this tab's
 * leadership and the database (closed, so its file is released). A repeat call after a stop warns
 * and does nothing.
 */
const stopClient = async ({ unsubscribe }: { unsubscribe: boolean }): Promise<void> => {
  if (clientManager.getSnapshot().status === 'stopped') {
    console.warn(CLIENT_ALREADY_STOPPED_WARNING)
    return
  }
  activeInitConfig = undefined
  cancelAllRetriesWhenOnline()
  unregisterSeedQueryLocalSource()
  resetAddressesPersistedAnnouncement()
  // The next init sets its own period. Instances waiting out this one are evicted with the rest
  // (releaseClientResources), which cancels their timers.
  setEntityUnloadGraceMs(undefined)
  clientManager.stop()
  if (unsubscribe) subscription.unsubscribe()
  notifyServiceListeners()
  const releasing = releaseClientResources()
  stopping = releasing
  try {
    await releasing
  } finally {
    if (stopping === releasing) stopping = undefined
  }
}

const releaseClientResources = async (): Promise<void> => {
  await stopOutbox()
  await whenCanonicalizeModelTypesSettled()
  // Before the database closes, so their live queries end first.
  for (const cache of [Item.cache, ItemProperty.cache, ModelProperty.cache, Model.cache, Schema.cache]) {
    evictEntities(cache as Parameters<typeof evictEntities>[0], () => true)
  }
  stopTabCoordination()
  await BaseDb.close()
}

const coalescedInit = createCoalescedAsync(async (options: any) => {
  // A stop still closing the database: open it again only once that's done.
  if (stopping) await stopping

  // If the actor is stopped (e.g., from a previous failed test), restart it
  const snapshot = clientManager.getSnapshot()
  const currentState = snapshot.value as string
  const isStopped = snapshot.status === 'stopped'
  
  if (isStopped) {
    // stop() (or a failed test) stopped it: start over with a new actor and a clean context.
    logger('Client manager was stopped, creating a new one')
    ;({ actor: clientManager, actorSubscription: subscription } = createClientManager())
    notifyServiceListeners()
  }

  // Clear any stale context from previous failed initializations
  // This ensures we start with a clean slate before the new init updates it
  if (!isStopped && currentState !== 'uninitialized') {
    logger(`Client manager is in state ${currentState}, clearing stale context before re-init...`)
    clientManager.send({ 
      type: 'updateContext', 
      context: {
        isInitialized: false,
        addressesSet: false,
        isSaving: false,
        syncFromEasOnAddressChange: false,
        endpoints: undefined,
        addresses: undefined,
        ownedAddresses: undefined,
        watchedAddresses: undefined,
        models: undefined,
        arweaveDomain: undefined,
        filesDir: undefined,
        dbConfig: undefined,
        initError: undefined,
        saveError: undefined,
      }
    })
  }
  
  setEntityUnloadGraceMs(options?.config?.entityCache?.unloadGraceMs)

  // The root-level init handler moves to PLATFORM_CLASSES_INIT (stopping any running step) as
  // send() returns; the platformClassesInit step fills the context from options.
  clientManager.send({ type: 'init', options });
  
  try {
    await waitFor(clientManager, (snapshot) => {
      return snapshot.context.isInitialized || snapshot.context.initError != null
    }, { timeout: 120000 });
    const initError = clientManager.getSnapshot().context.initError
    if (initError) {
      throw initError instanceof Error ? initError : new Error(String(initError))
    }
  } catch (error: any) {
    // Ensure we never throw undefined
    if (error === undefined || error === null) {
      throw new Error('Initialization failed with undefined error')
    }
    throw error
  }
  // Wire `@seedprotocol/query` local source once DB is ready
  registerSeedQueryLocalSource({ force: true })
}, () => {
  const snapshot = clientManager.getSnapshot()
  // A stopped client keeps its last state and context: init must run again, not be skipped.
  return (
    snapshot.status === 'active' &&
    snapshot.value === ClientManagerState.IDLE &&
    snapshot.context.isInitialized === true &&
    !snapshot.context.initError
  )
})

// Singleton instance - created once at module load time
// ES modules cache exports, ensuring all imports get the same instance
const clientInstance = {
  isInitialized: () => {
    const snapshot = clientManager.getSnapshot()
    return snapshot.status === 'active' && snapshot.context.isInitialized
  },
  getService: () => {
    // ensureInitialized();
    return clientManager;
  },
  /**
   * Calls `listener` with the clientManager actor when it changes: `init()` after `stop()`
   * replaces the actor, and `stop()` ends the current one. Subscribe to the actor itself for its
   * state changes. Returns a function that removes the listener.
   */
  subscribeService: (listener: (service: ClientService) => void): (() => void) => {
    serviceListeners.add(listener)
    return () => {
      serviceListeners.delete(listener)
    }
  },
  /**
   * Initialise the SDK. Calls made while an init is running share it. Once initialised, a
   * call with the same config resolves at once and applies any change in `addresses`; a
   * call with a different config throws INIT_CONFIG_CONFLICT_MESSAGE (call stop() first).
   */
  init: async (options: SeedConstructorOptions): Promise<void> => {
    if (activeInitConfig !== undefined && !isEqual(activeInitConfig, options?.config)) {
      throw new Error(INIT_CONFIG_CONFLICT_MESSAGE)
    }
    const isRepeat = activeInitConfig !== undefined
    activeInitConfig = options?.config
    try {
      await coalescedInit(options)
    } catch (error) {
      activeInitConfig = undefined
      throw error
    }
    if (isRepeat && options?.addresses !== undefined) {
      const wanted = normalizeAddressConfig(options.addresses)
      const current = { owned: await getOwnedAddressesFromDb(), watched: await getWatchedAddressesFromDb() }
      if (!isEqual(wanted, current)) {
        await clientInstance.setAddresses(wanted)
      }
    }
  },
  setAddresses: async (addresses: AddressConfiguration) => {
    ensureInitialized();
    logger('setAddresses', addresses);
    clientManager.send({ type: 'setAddresses', addresses });
    await waitFor(clientManager, (snapshot) => !snapshot.context.isSaving, { timeout: 10000 });
    const saveError = clientManager.getSnapshot().context.saveError
    if (saveError) {
      throw saveError instanceof Error ? saveError : new Error(String(saveError))
    }
    logger('setAddresses success', addresses);
  },
  getAddresses: async () => {
    ensureInitialized();
    const owned = await getOwnedAddressesFromDb();
    const watched = await getWatchedAddressesFromDb();
    return { owned, watched };
  },
  getOwnedAddresses: async () => {
    ensureInitialized();
    return getOwnedAddressesFromDb();
  },
  getWatchedAddresses: async () => {
    ensureInitialized();
    return getWatchedAddressesFromDb();
  },
  /**
   * Stamp local seeds/versions/metadata that have no publisher and no real uid.
   * Sealed rows (real EAS uid or attestationRaw) are left unchanged.
   * Use after `setAddresses` on connect; `setPublishWallet` does this automatically.
   */
  claimUnpublishedDrafts: async (publisher: string) => {
    ensureInitialized()
    const result = await claimUnpublishedDrafts(publisher)
    // Loaded Items read publisher from their context; give the claimed ones the new value.
    Item.setPublisherForCachedSeeds(result.seedLocalIds, publisher)
    return result
  },
  /**
   * Hard-delete local on-chain seed copies for the given publisher addresses.
   * Drafts (no uid / attestationRaw) are kept. Chain is untouched; reconnect can rehydrate via syncFromEas.
   */
  removeLocalCopiesForAddresses: async (addresses: string[]) => {
    ensureInitialized()
    const list = Array.isArray(addresses) ? addresses : []
    const matched = await findLocalOnchainCopiesForAddresses(list)
    const cacheIds = [
      ...matched.removedSeedLocalIds,
      ...matched.removedSeedUids,
    ]
    if (cacheIds.length > 0) {
      Item.dropCachedInstancesForSeedIds(cacheIds)
    }
    await hardDeleteLocalSeedsByLocalIds(matched.removedSeedLocalIds)
    // Other tabs drop their cached instances of the removed seeds too.
    emitAcrossTabs(LOCAL_COPIES_REMOVED_EVENT, {
      addresses: list,
      removedSeedLocalIds: matched.removedSeedLocalIds,
      removedSeedUids: matched.removedSeedUids,
    })
    return matched
  },
  /**
   * Syncs item attestations from EAS for the configured models and given addresses.
   * Uses owned + watched addresses from DB when addresses are not provided.
   */
  syncFromEas: async (options?: SyncFromEasOptions) => {
    ensureInitialized();
    startEasSyncActor();
    const correlationId =
      typeof globalThis.crypto?.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sendEasSyncClientRequest(correlationId, options);
    await waitFor(easSyncActor, (snapshot) =>
      snapshot.context.lastFinishedCorrelationIds?.includes(correlationId) ?? false,
    );
    const snap = easSyncActor.getSnapshot();
    if (snap.context.lastFinishedStatus === 'failed') {
      throw new Error(snap.context.lastFinishedError ?? 'EAS sync failed');
    }
  },
  addModel: async (modelDef: ModelDefObj) => {
    if (!BaseDb.getAppDb()) throw new Error('Database not found');
    await inDefinitionsTransaction((tx) => insertModelStubs(tx, [modelDef.name]));
    // Global service removed - model registration is now handled by ClientManager
    // Models are added to DB during the ADD_MODELS_TO_DB state
  },
  /**
   * Calls `callback` once the client is initialised, or on the next microtask if it already
   * is. Returns a function that cancels the callback.
   */
  onReady: (callback: () => void): (() => void) => {
    if (clientManager.getSnapshot().context.isInitialized) {
      let cancelled = false
      queueMicrotask(() => {
        if (!cancelled) callback()
      })
      return () => {
        cancelled = true
      }
    }
    const subscription = clientManager.subscribe((snapshot) => {
      if (snapshot.context.isInitialized) {
        subscription.unsubscribe()
        callback();
      }
    });
    return () => subscription.unsubscribe()
  },
  /**
   * Stops the client, from any state (a failed init too), and closes the database. Resolves once
   * everything is released; `init` may be called right away and waits for that.
   */
  stop: () => stopClient({ unsubscribe: false }),
  /** As `stop`, and also ends the client's internal state subscription. */
  unload: () => stopClient({ unsubscribe: true }),
}

// Export the singleton instance
// This ensures all imports across different files get the same instance
export const ClientManager = clientInstance

export const getClient = () => {
  return clientInstance
}
import { IItem, IItemProperty } from '@/interfaces'
import { timed, timedDb, timingLogger, timingNow, timingSince } from '@/helpers/timing'
import { itemMachineSingle } from '@/Item/service/itemMachineSingle'
import {
  INTERNAL_PROPERTY_NAMES,
  PROPERTY_NAMES_EXEMPT_FROM_ID_SUFFIX_STRIP,
} from '@/helpers/constants'
import { createReactiveProxy } from '@/helpers/reactiveProxy'
import {
  getAlternatePropertyNameForInstanceLookup,
  metadataRowPropertyKey,
  toItemPropertyKey,
  toSchemaPropertyName,
} from '@/helpers/metadataPropertyNames'
import { metadataPropertyKeyColumn } from '@/db/read/metadataProperty'
import { VersionsType } from '@/seedSchema'
// Dynamic import to break circular dependency: Model -> Item -> Model
// import { Model } from '@/Model/Model'

import {
  CreatePropertyInstanceProps,
  ItemData,
  ItemFindProps,
  ModelSchema,
  ModelValues,
  NewItemProps,
  PropertyData
} from '@/types'
import type { ItemCreateOptions } from '@/types'
import type { ItemPublishOptions } from '@/helpers/publishConfig'
import { normalizePublisher } from '@/helpers/addresses'

import { BehaviorSubject } from 'rxjs'
import {
  ActorRefFrom,
  Subscription,
  createActor,
  isMachineSnapshot,
  SnapshotFrom,
  waitFor,
} from 'xstate'
import { orderBy } from 'lodash-es'
import { getItemData } from '@/db/read/getItemData'
import { getItemsData } from '@/db/read/getItems'
import { isVersionRevoked } from '@/db/read/subqueries/liveVersion'
import { LATEST_VERSION_ORDER_SQL } from '@/db/read/subqueries/latestVersion'
import { getLatestVersionRow } from '@/db/read/getLatestVersionRow'
import { ItemProperty, ItemPropertySaveValidationError } from '@/ItemProperty/ItemProperty'
import { getItemProperties } from '@/db/read/getItemProperties'
import { createNewItem } from '@/db/write/createNewItem'
import { BaseDb } from '@/db/Db/BaseDb'
import { queryEntityRows, watchEntityRows } from '@/browser/db/changeFeed'
import { properties as propertiesTable } from '@/seedSchema'
import { modelPropertiesToObject } from '@/helpers/model'
import { DEFAULT_READY_TIMEOUT_MS, waitForEntityIdle } from '@/helpers/waitForEntityIdle'
import { ModelPropertyDataTypes, isDataType, normalizeDataType } from '@/helpers/property'
import { isStorageSeedRef } from '@/helpers/relationSeedRef'
import { findEntity } from '@/helpers/entity/entityFind'
import { unloadEntity } from '@/helpers/entity/entityUnload'
import { ActorKeyedState } from '@/helpers/entity/entityState'
import { isActorStopped, sameEntity } from '@/helpers/entity/entityCommon'
import {
  clearDestroySubscriptions,
  forceRemoveFromCaches,
  runDestroyLifecycle,
} from '@/helpers/entity/entityDestroy'
import { deleteItem } from '@/db/write/deleteItem'
import { updateSeedUid } from '@/db/write/updateSeedUid'
import { eq, getTableColumns } from 'drizzle-orm'
import debug from 'debug'

const itemLogger = debug('seedSdk:Item')

// Fallback helper for synchronous Model access when modelInstance is not provided
// This is only used as a fallback - the preferred approach is to pass modelInstance
// directly to Item constructor (which Model.create() instance method does).
// Since Model.getByName() is synchronous and just accesses a cache, Model must be loaded
// when Item constructor runs (because Model imports Item).
let ModelClass: typeof import('@/Model/Model').Model | null = null
let modelImportPromise: Promise<typeof import('@/Model/Model')> | null = null

const getModel = (): typeof import('@/Model/Model').Model => {
  if (!ModelClass) {
    // Start loading Model if not already started.
    // Use async/await so rollup's two-step dynamic-import rewrite can neutralize
    // the fragile `import(...).then(n => n.X)` chunk-namespace pattern.
    if (!modelImportPromise) {
      modelImportPromise = (async () => {
        const mod = await import('@/Model/Model')
        ModelClass = mod.Model
        return mod
      })()
      modelImportPromise.catch(() => {
        // If import fails, ModelClass remains null
      })
    }
    // For synchronous access, we need Model to already be loaded
    // If it's not loaded yet, this will throw, but in practice Model is always loaded
    // because Model imports Item, creating the initialization order
    if (!ModelClass) {
      // Fallback: try to access Model directly (works if already in module cache)
      try {
        const modelModule = (globalThis as any).__seedModelModule || 
          (typeof window !== 'undefined' && (window as any).__seedModelModule)
        if (modelModule) {
          ModelClass = modelModule.Model
        }
      } catch {
        // If Model isn't available, throw a more helpful error
        throw new Error('Model class not available. This may indicate a circular dependency issue.')
      }
    }
  }
  return ModelClass!
}

// Define tracked properties for the Proxy
// These properties will be read from/written to the actor context
/**
 * Initial values that need ItemProperty.save() rather than a verbatim metadata row: raw File/Image/Html
 * content (not already a storage seed reference) becomes a storage seed, and an ItemStorage property's
 * content goes into its file (`<seedLocalId><extension>`), where publish and reads look for it.
 */
function needsStorageSavePipeline(
  dataType: string | undefined,
  value: unknown,
  storageType?: string | null,
): boolean {
  if (value == null || value === '') return false
  if (storageType === 'ItemStorage') return true
  const isStorageType =
    isDataType(dataType, ModelPropertyDataTypes.File) ||
    isDataType(dataType, ModelPropertyDataTypes.Image) ||
    isDataType(dataType, ModelPropertyDataTypes.Html)
  return isStorageType && !isStorageSeedRef(value)
}

const TRACKED_PROPERTIES = [
  'seedLocalId',
  'seedUid',
  'modelName',
  'schemaUid',
  'latestVersionLocalId',
  'latestVersionUid',
  'publisher',
  'revokedAt',
] as const

// Mutable state per Item instance
const itemInstanceState = new ActorKeyedState<Item<any>, {
  liveQuerySubscription: { unsubscribe: () => void } | null // LiveQuery subscription for cross-instance updates
}>()

/**
 * Seed uids an item has moved away from (a republish gives the item a new seed uid) whose seed row
 * may still hold them: the new uid is set on the item before its DB write lands, and until then the
 * seeds liveQuery can deliver the old row. Rows carrying one of these uids are ignored; the set is
 * cleared once the row carries the item's current uid. Lower-cased. Keyed by the item's actor,
 * which the instance and its reactive proxy share.
 */
const supersededSeedUids = new WeakMap<object, Set<string>>()

/**
 * The ItemProperty instances an item holds, keyed by the item's actor, then by each property's
 * actor. An item takes one hold on each instance in its `propertyInstances` map while it is there
 * and releases it when the instance leaves the map or the item's actor stops. The SDK code that puts
 * instances in the map looks them up with `hold: false`, so these are their only item-owned holds.
 */
const propertyHolds = new WeakMap<object, Map<object, IItemProperty<any>>>()

function syncPropertyHolds(itemService: object, propertyInstances: Map<PropertyKey, IItemProperty<any>> | undefined): void {
  let held = propertyHolds.get(itemService)
  if (!held) {
    held = new Map()
    propertyHolds.set(itemService, held)
  }
  const current = new Set<object>()
  for (const property of propertyInstances?.values() ?? []) {
    const propertyService = property.getService()
    current.add(propertyService)
    if (!held.has(propertyService) && ItemProperty.retain(property)) held.set(propertyService, property)
  }
  for (const [propertyService, property] of held) {
    if (current.has(propertyService)) continue
    held.delete(propertyService)
    property.unload()
  }
}

/** When the item's actor stops: its holds, then its properties nobody holds (see unloadUnheldForItem). */
function releaseItemProperties(itemService: ActorRefFrom<typeof itemMachineSingle>): void {
  releasePropertyHolds(itemService)
  const { seedLocalId, seedUid } = itemService.getSnapshot().context
  ItemProperty.unloadUnheldForItem([seedLocalId, seedUid])
}

function releasePropertyHolds(itemService: object): void {
  const held = propertyHolds.get(itemService)
  if (!held) return
  propertyHolds.delete(itemService)
  for (const property of held.values()) {
    try {
      property.unload()
    } catch {
      // Already stopped
    }
  }
}

/**
 * Each Item's reactive proxy, keyed by its actor. The class's arrow-function methods see the raw
 * instance as `this`, where tracked properties such as `seedUid` are getter-only and model
 * properties (`item.title`) don't exist; anything they hand the item to (the publish executor)
 * must get the proxy.
 */
const reactiveProxies = new WeakMap<object, Item<any>>()

/** The latest seed uid write per item, keyed by its actor (see `_persistSeedUid`). */
const pendingSeedUidWrites = new WeakMap<object, Promise<void>>()

export class Item<T extends ModelValues<ModelSchema>> implements IItem<T> {

  protected static instanceCache: Map<string, { instance: Item<any>; refCount: number }> = new Map();
  protected _subscription: Subscription | undefined;
  protected readonly _storageTransactionId: string | undefined;
  protected _propertiesSubject: BehaviorSubject<Record<string, IItemProperty>> = new BehaviorSubject({});
  protected readonly _service: ActorRefFrom<typeof itemMachineSingle>;

  constructor(initialValues: NewItemProps<T>) {
    const {
      modelName,
      seedUid,
      schemaUid,
      seedLocalId,
      latestVersionLocalId,
      latestVersionUid,
      modelInstance,
      publisher,
    } = initialValues
    const modelFileId =
      ((initialValues as Record<string, unknown>).modelFileId as string | undefined) ?? modelInstance?.id

    // Store modelInstance if provided (for backward compatibility)
    // But Item no longer depends on Model being loaded - it loads properties from database directly
    if (initialValues.storageTransactionId) {
      this._storageTransactionId = initialValues.storageTransactionId
    }

    this._service = createActor(itemMachineSingle, {
      input: {
        seedLocalId,
        seedUid,
        schemaUid,
        modelName,
        modelFileId,
        schemaName: ((initialValues as Record<string, unknown>).schemaName as string | undefined) ?? modelInstance?.schemaName,
        latestVersionLocalId,
        latestVersionUid,
        publisher,
        storageTransactionId: this._storageTransactionId,
        // ModelClass is no longer needed - Item loads properties from database independently
      },
    })

    this._subscription = this._service.subscribe((snapshot: SnapshotFrom<typeof itemMachineSingle>) => {
      const { context } = snapshot

      if (
        !context ||
        !context.propertyInstances ||
        context.propertyInstances.size === 0
      ) {
        return
      }

      const propertiesObj: Record<string, IItemProperty> = {}

      for (const [key, propertyInstance] of context.propertyInstances) {
        if (typeof key !== 'string' || INTERNAL_PROPERTY_NAMES.includes(key)) {
          propertiesObj[key.toString()] = propertyInstance
          continue
        }

        propertiesObj[toItemPropertyKey(key, propertyInstance.alias)] = propertyInstance
      }

      this._propertiesSubject.next(propertiesObj)
    })

    // Hold the properties in the map; release them all when the actor stops (last unload, destroy,
    // eviction or error), whichever teardown path stops it.
    const itemService = this._service
    itemService.subscribe({
      next: (snapshot) => syncPropertyHolds(itemService, snapshot.context?.propertyInstances),
      complete: () => releaseItemProperties(itemService),
      error: () => releaseItemProperties(itemService),
    })

    this._service.start()

    // Initialize instance state in WeakMap
    itemInstanceState.set(this, {
      liveQuerySubscription: null,
    })
    
    // Set up liveQuery subscription for cross-instance updates
    this._setupLiveQuerySubscription()

    // Properties are now loaded from database via loadOrCreateItem actor
    // Create property instances for all model properties plus any keys in initialValues,
    // so that e.g. newPost.title = '...' works even when the item was created with no initial values.
    const itemPropertyBase: Partial<CreatePropertyInstanceProps> = {
      seedLocalId,
      seedUid,
      versionLocalId: latestVersionLocalId,
      versionUid: latestVersionUid,
      modelName,
      modelFileId,
    }

    const metadataKeys = [
      'modelName',
      'modelFileId',
      'schemaName',
      'modelInstance',
      'seedLocalId',
      'seedUid',
      'schemaUid',
      'latestVersionLocalId',
      'latestVersionUid',
      'publishedVersionUid',
      'publishedVersionLocalId',
      'revokedAt',
    ] as const

    const keysFromInitial = (Object.keys(initialValues) as Array<string & keyof Partial<T>>).filter(
      (key) => !metadataKeys.includes(key as any),
    )
    const schemaNameForModel = (initialValues as Record<string, unknown>).schemaName as string | undefined

    let model: import('@/Model/Model').Model | undefined
    try {
      const M = getModel()
      model = M != null ? M.resolve(modelName, { modelFileId, schemaName: schemaNameForModel }) : undefined
    } catch {
      model = undefined
    }
    const propertySchemas = model?.properties?.length
      ? modelPropertiesToObject(model.properties)
      : {}
    const modelPropertyNames = this._getModelPropertyNames(schemaNameForModel)
    const schemaKeys = modelPropertyNames.length > 0 ? modelPropertyNames : Object.keys(propertySchemas)
    // Normalize Id-suffix keys from initialValues: metadata stores textId but schema defines text
    const normalizedKeysFromInitial = keysFromInitial.map((key) => {
      if (key.endsWith('Id') && !PROPERTY_NAMES_EXEMPT_FROM_ID_SUFFIX_STRIP.has(key)) {
        const baseName = key.slice(0, -2)
        if (schemaKeys.length > 0 && schemaKeys.includes(baseName)) return baseName
        if (schemaKeys.length === 0) return baseName
      }
      return key
    })
    const allKeys = new Set<string>([...normalizedKeysFromInitial, ...modelPropertyNames])

    const initialRecord = initialValues as Record<string, unknown>
    for (const key of allKeys) {
      if (INTERNAL_PROPERTY_NAMES.includes(key)) {
        continue
      }
      const propSchema = propertySchemas[key] ?? undefined
      const propertyValue = initialRecord[key] ?? initialRecord[`${key}Id`] ?? undefined
      this._createPropertyInstance({
        ...itemPropertyBase,
        propertyName: key,
        propertyValue,
        propertyRecordSchema: propSchema,
      })
    }
  }

  /** Prefer local id so list rows (local + uid) resolve the same cache entry as early draft loads. */
  private static findItemInstanceCacheEntryByProps(
    props: Partial<ItemData>,
  ): { instance: Item<any>; refCount: number } | undefined {
    const l = props.seedLocalId
    const u = props.seedUid
    if (typeof l === 'string' && l.length > 0) {
      const e = this.instanceCache.get(l)
      if (e) return e
    }
    if (typeof u === 'string' && u.length > 0) {
      const e = this.instanceCache.get(u)
      if (e) return e
    }
    return undefined
  }

  private static findItemInstanceCacheEntryById(
    id: string,
  ): { instance: Item<any>; refCount: number } | undefined {
    const direct = this.instanceCache.get(id)
    if (direct) return direct
    for (const [, entry] of this.instanceCache) {
      const ctx = entry.instance._getSnapshotContext() as any
      if (ctx.seedLocalId === id || ctx.seedUid === id) return entry
    }
    return undefined
  }

  private static collectInstanceCacheKeysForInstance(instance: Item<any>): string[] {
    const keys: string[] = []
    for (const [k, v] of this.instanceCache) {
      if (sameEntity(v.instance, instance)) keys.push(k)
    }
    return keys
  }

  private static registerItemInInstanceCache(instance: Item<any>): void {
    const ctx = instance._getSnapshotContext() as any
    const lid: string | undefined =
      typeof ctx.seedLocalId === 'string' && ctx.seedLocalId.length > 0
        ? ctx.seedLocalId
        : undefined
    const uid: string | undefined =
      typeof ctx.seedUid === 'string' && ctx.seedUid.length > 0 ? ctx.seedUid : undefined
    const entry = { instance, refCount: 1 }
    if (lid) this.instanceCache.set(lid, entry)
    if (uid && uid !== lid) this.instanceCache.set(uid, entry)
    if (!lid && !uid) {
      throw new Error('Item.registerItemInInstanceCache: missing seedLocalId and seedUid')
    }
  }

  /**
   * Wraps a new instance in its reactive proxy: tracked names read from and write to the actor's
   * context, and the model's property names (`item.title`, or `item.html` for `htmlId`) read and
   * write their ItemProperty's value.
   */
  private static wrapInProxy(instance: Item<any>): Item<any> {
    const proxy = createReactiveProxy<Item<any>>({
      instance,
      service: instance._service,
      trackedProperties: TRACKED_PROPERTIES,
      getContext: (target) => target._getSnapshotContext(),
      sendUpdate: (target, prop, value) => {
        if (prop === 'publisher') throw new Error('Cannot set item.publisher: publisher is read-only.')
        Item.sendTrackedPropertyUpdate(target, prop, value)
        if (prop === 'seedUid' && typeof value === 'string' && value.length > 0) {
          target._persistSeedUid(value)
        }
      },
      resolve: (target, prop) => {
        const property = target._findPropertyInstance(prop)
        if (!property) return undefined
        return {
          get: () => property.value,
          set: (value) => {
            property.value = value
          },
        }
      },
      virtualKeys: (target) => target._propertyInstanceNames(),
      onSet: (_target, prop) => {
        if (prop === 'properties') {
          // Properties are read-only computed values from propertyInstances, managed via ItemProperty instances
          throw new Error('Cannot set item.properties directly. Properties are computed from ItemProperty instances.')
        }
      },
    }) as Item<any>
    reactiveProxies.set(instance._service, proxy)
    return proxy
  }

  /**
   * The ItemProperty a model property name reads and writes on the item: by its name, or by its
   * storage name (`html` finds `htmlId` and the other way round). Internal names don't resolve.
   */
  private _findPropertyInstance(propertyName: string): IItemProperty | undefined {
    if (INTERNAL_PROPERTY_NAMES.includes(propertyName)) return undefined
    const instances = this._service.getSnapshot().context.propertyInstances
    if (!instances || instances.size === 0) return undefined
    const direct = instances.get(propertyName)
    if (direct) return direct
    const altKey = getAlternatePropertyNameForInstanceLookup(propertyName)
    return altKey ? instances.get(altKey) : undefined
  }

  /** Every name `_findPropertyInstance` resolves: the stored names and their schema names. */
  private _propertyInstanceNames(): string[] {
    const instances = this._service.getSnapshot().context.propertyInstances
    if (!instances) return []
    const names = new Set<string>()
    for (const key of instances.keys()) {
      if (typeof key !== 'string' || INTERNAL_PROPERTY_NAMES.includes(key)) continue
      names.add(key)
      const schemaName = toSchemaPropertyName(key)
      if (schemaName && !INTERNAL_PROPERTY_NAMES.includes(schemaName)) names.add(schemaName)
    }
    return [...names]
  }

  /**
   * Writes an assigned seed uid to the item's seed row, so later loads and getPublishPayload see it.
   * Writes run one after another per item, so the last assignment is the one that stays.
   */
  private _persistSeedUid(seedUid: string): void {
    const seedLocalId = this._getSnapshotContext().seedLocalId
    if (!seedLocalId) return
    const previous = pendingSeedUidWrites.get(this._service) ?? Promise.resolve()
    const write = previous
      .then(() => updateSeedUid({ seedLocalId, seedUid }))
      .catch((err) => {
        itemLogger('updateSeedUid failed:', err)
      })
    pendingSeedUidWrites.set(this._service, write)
  }

  /**
   * Sets a tracked context property from the proxy. Setting `seedUid` to a different uid means a
   * new seed attestation (publishing again after unpublish): the revocation belonged to the old
   * one, so `revokedAt` is cleared, and the instance cache's uid alias moves to the new uid.
   */
  private static sendTrackedPropertyUpdate(target: Item<any>, prop: string, value: unknown): void {
    const previousSeedUid =
      prop === 'seedUid' ? (target._getSnapshotContext() as { seedUid?: string }).seedUid : undefined
    const replacesSeedUid =
      typeof value === 'string' &&
      value.length > 0 &&
      typeof previousSeedUid === 'string' &&
      previousSeedUid.length > 0 &&
      previousSeedUid !== value
    target._service.send({
      type: 'updateContext',
      [prop]: value,
      ...(replacesSeedUid && { revokedAt: undefined }),
    } as any)
    if (prop === 'seedUid' && typeof value === 'string' && value.length > 0) {
      const superseded = supersededSeedUids.get(target._service) ?? new Set<string>()
      superseded.delete(value.toLowerCase())
      if (replacesSeedUid) superseded.add(previousSeedUid!.toLowerCase())
      supersededSeedUids.set(target._service, superseded)
    }
    if (replacesSeedUid) {
      const entry = this.instanceCache.get(previousSeedUid!)
      if (entry) {
        this.instanceCache.delete(previousSeedUid!)
        this.instanceCache.set(value as string, entry)
      }
    }
  }

  /** Drops one holder's reference. Returns true while other holders still have the instance. */
  private static releaseItemInstanceCacheHold(instance: Item<any>): boolean {
    const keys = this.collectInstanceCacheKeysForInstance(instance)
    if (keys.length === 0) return false
    const entry = this.instanceCache.get(keys[0])!
    entry.refCount -= 1
    if (entry.refCount <= 0) {
      for (const k of keys) {
        this.instanceCache.delete(k)
      }
      return false
    }
    return true
  }

  /**
   * Idle, and not the shell the item machine can be in when it reaches `idle` before
   * `propertyInstances` is merged (an item with a version but no property instances yet).
   */
  private static isItemSnapshotReadyForRead(snap: any): boolean {
    if (!snap || !('value' in snap) || snap.value !== 'idle') {
      return false
    }
    const ctx = snap.context || {}
    const versionsCount = ctx.versionsCount ?? 0
    const hasHeadVersion = !!ctx.latestVersionLocalId
    if (versionsCount === 0 && !hasHeadVersion) {
      return true
    }
    return (ctx.propertyInstances?.size ?? 0) > 0
  }

  /**
   * The cached Item for a seedLocalId or seedUid, in any state, without taking a hold. For SDK code
   * that reads or messages the item and doesn't hand it to a caller.
   */
  static peek(id: string | null | undefined): Item<any> | undefined {
    return id ? this.findItemInstanceCacheEntryById(id)?.instance : undefined
  }

  /**
   * The cached Item for a seedLocalId or seedUid when it can be read right now: idle and hydrated,
   * so at least what `Item.find()` would wait for. Otherwise undefined. Unlike `getById`, it takes
   * no cache hold, so React hooks can call it during render.
   */
  static peekReady(id: string | undefined): Item<any> | undefined {
    if (!id) return undefined
    const instance = this.findItemInstanceCacheEntryById(id)?.instance
    if (!instance) return undefined
    const snap = instance.getService().getSnapshot()
    if ((snap as { status?: string }).status !== 'active') return undefined
    return this.isItemSnapshotReadyForRead(snap) ? instance : undefined
  }

  /**
   * Item machine can reach `idle` before `propertyInstances` is merged (race) or while
   * child ItemProperty actors are still hydrating. useItems / Item.all must not return that shell.
   */
  private static async waitForItemInstanceReadyForRead(
    item: Item<any>,
    readyTimeout: number,
  ): Promise<void> {
    const label = `item ${item.seedLocalId ?? item.seedUid}`
    await timedDb(`${label} ready: item idle`, () => waitForEntityIdle(item, { timeout: readyTimeout }))
    const svc = item.getService()
    try {
      await timed(`${label} ready: property instances`, () => waitFor(
        svc,
        (snap: any) => {
          if ('value' in snap && snap.value === 'error') {
            throw new Error('Entity failed to load')
          }
          return Item.isItemSnapshotReadyForRead(snap)
        },
        { timeout: readyTimeout },
      ))
    } catch (e: any) {
      if (e?.message === 'Entity failed to load') {
        throw e
      }
      const msg = typeof e?.message === 'string' ? e.message : ''
      const isWaitForTimeout =
        msg.includes('Timeout') || msg.toLowerCase().includes('timed out')
      if (!isWaitForTimeout) {
        throw e
      }
      timingLogger(
        `item ${item.seedLocalId ?? item.seedUid} not ready for read after ${readyTimeout}ms (no property instances); continuing`,
      )
    }
    const snap = svc.getSnapshot() as any
    const pis = snap.context?.propertyInstances as
      | Map<string, { getService(): any }>
      | undefined
    if (!pis || pis.size === 0) {
      return
    }
    await timedDb(`${label} ready: ${pis.size} properties idle`, () => Promise.all(
      [...pis.values()].map((prop) =>
        waitForEntityIdle(prop, {
          timeout: readyTimeout,
          throwOnError: false,
        }),
      ),
    ))
    if (timingLogger.enabled) {
      const notIdle = [...pis.entries()]
        .filter(([, prop]) => {
          const propSnap = prop.getService().getSnapshot()
          return propSnap.value !== 'idle' || propSnap.context?.isSaving
        })
        .map(([name]) => name)
      if (notIdle.length > 0) {
        timingLogger(
          `item ${item.seedLocalId ?? item.seedUid}: properties still not idle after waiting up to ${readyTimeout}ms, continuing: ${notIdle.join(', ')}`,
        )
      }
    }
  }

  private static itemCacheEntryLooksUnhydratedAfterIdle(
    instance: Item<any>,
    props: Partial<ItemData>,
  ): boolean {
    const snap = instance.getService().getSnapshot() as SnapshotFrom<typeof itemMachineSingle>
    if (snap.value !== 'idle') return false
    const mapSize = snap.context.propertyInstances?.size ?? 0
    if (mapSize > 0) return false
    const ctx = snap.context as any
    const versionsCount = (props as any).versionsCount ?? ctx.versionsCount ?? 0
    const hasVersionHead =
      versionsCount > 0 ||
      !!(props as any).latestVersionLocalId ||
      !!ctx.latestVersionLocalId ||
      !!(props as any).latestVersionUid ||
      !!ctx.latestVersionUid
    return hasVersionHead
  }

  static async create<_T extends ModelValues<ModelSchema>>(
    props: Partial<ItemData> & { modelInstance?: import('@/Model/Model').Model },
    options?: ItemCreateOptions,
  ): Promise<Item<any>> {
    const waitForReady = options?.waitForReady !== false
    const readyTimeout = options?.readyTimeout ?? DEFAULT_READY_TIMEOUT_MS

    if (!props.modelName && props.type) {
      // The model the seed's type names (its easName, at the model's nameMatch level): `blog_post`
      // finds "Blog Post". No match leaves the type, which then fails as an unknown model.
      const { resolveModelRecordByNameOrType } = await import('../db/read/resolveModelRecord')
      const model = await resolveModelRecordByNameOrType(props.type, {
        modelFileId: (props as any).modelFileId,
        schemaName: (props as any).schemaName,
      })
      props.modelName = model?.name ?? props.type
    }
    if (props.seedUid || props.seedLocalId) {
      cacheReuse: {
        const cachedEntry = this.findItemInstanceCacheEntryByProps(props)
        if (cachedEntry) {
          const instance = cachedEntry.instance
          cachedEntry.refCount += 1
          for (const [propertyName, propertyValue] of Object.entries(props)) {
            const snapshot = instance.getService().getSnapshot() as SnapshotFrom<typeof itemMachineSingle>
            const propertyInstances = snapshot.context.propertyInstances
            if (!propertyInstances || !propertyInstances.has(propertyName)) {
              continue
            }
            const propertyInstance = propertyInstances.get(propertyName)
            if (!propertyInstance) {
              continue
            }
            propertyInstance.getService().send({
              type: 'updateContext',
              propertyValue,
            })
          }
          if (!waitForReady) return instance
          try {
            await this.waitForItemInstanceReadyForRead(instance, readyTimeout)
          } catch (err) {
            try {
              instance.unload()
            } catch {
              /* best-effort cache cleanup */
            }
            throw err
          }
          if (
            waitForReady &&
            this.itemCacheEntryLooksUnhydratedAfterIdle(instance, props)
          ) {
            forceRemoveFromCaches(instance, {
              getCacheKeys: () => this.collectInstanceCacheKeysForInstance(instance),
              caches: [Item.instanceCache as Map<string, unknown>],
            })
            try {
              unloadEntity(instance, {
                getCacheKeys: () => [],
                caches: [],
                instanceState: itemInstanceState,
                getService: (inst) => inst._service,
                onUnload: (inst) => {
                  inst._subscription?.unsubscribe()
                },
              })
            } catch {
              /* best-effort teardown for stale cached shell */
            }
            break cacheReuse
          }
          return instance
        }
      }

      if (!this.findItemInstanceCacheEntryByProps(props)) {
        // Item no longer needs modelInstance - it loads properties from database independently
        // Exclude latestVersionUid from props as it has incompatible types (string vs VersionsType)
        const { latestVersionUid, ...propsWithoutVersionUid } = props
        const propsWithModel = { ...propsWithoutVersionUid } as any
        const newInstance = new Item(propsWithModel)
        
        const proxiedInstance = Item.wrapInProxy(newInstance)

                this.registerItemInInstanceCache(proxiedInstance)
        if (!waitForReady) return proxiedInstance
        try {
          await this.waitForItemInstanceReadyForRead(proxiedInstance, readyTimeout)
        } catch (err) {
          try {
            proxiedInstance.unload()
          } catch {
            /* best-effort cache cleanup */
          }
          throw err
        }
        return proxiedInstance
      }
    }
    if (!props.modelName) {
      throw new Error('Model name is required to create an item')
    }
    // Filter out ItemData metadata properties - only pass model schema properties
    // Use schemaName / modelInstance from props if available (passed from Model.create() instance method)
    const schemaName = (props as any).schemaName as string | undefined
    const modelInstance = (props as any).modelInstance as { id?: string; schemaName?: string } | undefined
    
    // Get property names directly from database to make Item independent from Model
    let propertyNames: string[] = []
    const dataTypeByPropertyName = new Map<string, string>()
    const storageTypeByPropertyName = new Map<string, string>()
    const db = BaseDb.getAppDb()
    if (db && props.modelName) {
      // Model names are only unique per schema: resolve the exact models row from the most specific scope.
      const { resolveModelRecord } = await import('../db/read/resolveModelRecord')
      const modelRecord = await resolveModelRecord(props.modelName, {
        modelFileId: (props as any).modelFileId ?? modelInstance?.id,
        schemaName: schemaName ?? modelInstance?.schemaName,
      })
      const modelRecords = modelRecord ? [modelRecord] : []
      if (!modelRecord) {
        const { UnknownModelError } = await import('./errors')
        throw new UnknownModelError(props.modelName, schemaName ?? modelInstance?.schemaName)
      }
      if (modelRecord?.schemaFileId) {
        ;(props as any).modelFileId = modelRecord.schemaFileId
      }
      // Scope the constructor's Model lookup to this model's schema (as getItemData does on reload),
      // so a same-named model cached from another schema can't supply the property set.
      if (modelRecord && !(props as any).schemaName) {
        const { getModelSchemaName } = await import('../db/read/resolveModelRecord')
        const modelSchemaName = await getModelSchemaName(modelRecord.id, db)
        if (modelSchemaName) {
          ;(props as any).schemaName = modelSchemaName
        }
      }
      
      if (modelRecords.length > 0 && modelRecords[0].id) {
        const propertyRecords = await db
          .select({
            name: propertiesTable.name,
            dataType: propertiesTable.dataType,
            storageType: propertiesTable.storageType,
          })
          .from(propertiesTable)
          .where(eq(propertiesTable.modelId, modelRecords[0].id))
        
        propertyNames = propertyRecords.map((r: { name: string | null }) => r.name).filter((name: string | null): name is string => Boolean(name))
        for (const r of propertyRecords) {
          if (r.name && r.dataType) dataTypeByPropertyName.set(r.name, r.dataType)
          if (r.name && r.storageType) storageTypeByPropertyName.set(r.name, r.storageType)
        }
      }
    }
    
    const modelPropertyData: Partial<ModelValues<ModelSchema>> & { modelName: string; modelFileId?: string } = {
      modelName: props.modelName,
      modelFileId: (props as any).modelFileId,
    }
    // File/Image/Html values that are raw content (html string, data URI, URL, File) must go through
    // the property's save pipeline to become storage seeds, and ItemStorage values to be written to
    // their file with the property context pointing at it (as `prop.value = v; await prop.save()`).
    const pipelineValues: Array<[string, unknown]> = []
    
    // Only include properties that are in the model schema
    // Exclude modelInstance, modelName, and schemaName as they're metadata, not item properties
    for (const [key, value] of Object.entries(props)) {
      // Skip metadata properties that aren't part of the item's data
      if (key === 'modelName' || key === 'schemaName' || key === 'modelInstance' || key === 'modelFileId') {
        continue
      }
      if (propertyNames.length === 0 || propertyNames.includes(key)) {
        if (
          needsStorageSavePipeline(
            dataTypeByPropertyName.get(key),
            value,
            storageTypeByPropertyName.get(key),
          )
        ) {
          pipelineValues.push([key, value])
          continue
        }
        // If we couldn't get property names from DB, include all properties
        // Type assertion: we've filtered out modelInstance above, so value should be a valid property value
        modelPropertyData[key] = value as any
      }
    }
    // Strict by default: unknown keys and invalid values reject before anything is written.
    // Values that go through the property save pipeline (files, Html, ItemStorage) are
    // validated there.
    if (propertyNames.length > 0 && options?.validate !== false) {
      await Item.assertValidCreateValues(props, propertyNames, dataTypeByPropertyName, new Set(pipelineValues.map(([key]) => key)))
    }
    const { seedLocalId, versionLocalId, } = await createNewItem(modelPropertyData)
    props.seedLocalId = seedLocalId
    props.latestVersionLocalId = versionLocalId
    // Don't seed property instances with raw storage content: the value setter skips unchanged
    // values, so savePipelineValues would never trigger a save.
    for (const [key] of pipelineValues) {
      delete (props as Record<string, unknown>)[key]
    }
    // Item no longer needs modelInstance - it loads properties from database independently
    // Exclude latestVersionUid from props as it has incompatible types (string vs VersionsType)
    const { latestVersionUid, ...propsWithoutVersionUid } = props
    const propsWithModel = { ...propsWithoutVersionUid } as any
    const newInstance = new Item(propsWithModel)
    
    const proxiedInstance = Item.wrapInProxy(newInstance)
    
        this.registerItemInInstanceCache(proxiedInstance)
    // Storage values must be saved before returning, so wait for readiness even when not requested.
    if (!waitForReady && pipelineValues.length === 0) return proxiedInstance
    try {
      await this.waitForItemInstanceReadyForRead(proxiedInstance, readyTimeout)
      await this.savePipelineValues(proxiedInstance, pipelineValues, readyTimeout)
    } catch (err) {
      // A rejected create leaves nothing behind, so a retry doesn't make a second draft.
      await this.discardCreatedItem(proxiedInstance, seedLocalId)
      throw err
    }
    return proxiedInstance
  }

  /**
   * Stops a just-created item and deletes what create wrote: a `discard` outbox op (ADR 0019),
   * applied after the item's other pending ops, hard-deletes the draft and the storage seeds its
   * rows point at; their files go once it has applied.
   */
  private static async discardCreatedItem(item: Item<any>, seedLocalId: string): Promise<void> {
    try {
      this.dropCachedInstancesForSeedIds([seedLocalId])
    } catch {
      /* best-effort cache cleanup */
    }
    try {
      const { appendOutboxOpAndWait, deleteFiles, startItemOutbox } = await import('@/outbox')
      startItemOutbox()
      const applied = await appendOutboxOpAndWait<import('@/outbox').DeleteResult>({
        seedLocalId,
        kind: 'delete',
        value: { mode: 'discard' } satisfies import('@/outbox').DeleteOp,
      })
      if (!applied.superseded) await deleteFiles(applied.result?.filePaths ?? [])
    } catch (error) {
      itemLogger(`Item.create: could not remove the draft ${seedLocalId} after a failure:`, error)
    }
  }

  /**
   * Run each File/Image/Html/ItemStorage initial value through its ItemProperty save pipeline (sequentially, to
   * avoid SQLite write contention). Rejects on the first failure, with ItemCreateValidationError when the
   * value breaks its property's rules and ItemCreateError otherwise; Item.create then removes the item.
   */
  private static async savePipelineValues(
    item: Item<any>,
    pipelineValues: Array<[string, unknown]>,
    timeout: number,
  ): Promise<void> {
    for (const [propertyName, value] of pipelineValues) {
      const property = await this.waitForPropertyInstance(item, propertyName, timeout)
      if (!property) {
        const { ItemCreateError } = await import('./errors')
        throw new ItemCreateError(
          `Item.create: property ${item.modelName}.${propertyName} did not load for item ${item.seedLocalId}; value was not saved`,
          { code: 'property_not_loaded', modelName: item.modelName, property: propertyName, seedLocalId: item.seedLocalId },
        )
      }
      // setValue, not the setter: the setter skips the save when the value is already in context.
      property.setValue(value)
      try {
        await property.save()
      } catch (error) {
        if (error instanceof ItemPropertySaveValidationError) {
          const { ItemCreateValidationError } = await import('./errors')
          const created = new ItemCreateValidationError(
            item.modelName,
            error.validationErrors.map((e) => ({ property: propertyName, code: e.code, message: e.message })),
          )
          ;(created as Error & { cause?: unknown }).cause = error
          throw created
        }
        const { ItemCreateError } = await import('./errors')
        throw new ItemCreateError(
          `Item.create: failed to save ${item.modelName}.${propertyName} for item ${item.seedLocalId}: ` +
            (error instanceof Error ? error.message : String(error)),
          { code: 'save_failed', modelName: item.modelName, property: propertyName, seedLocalId: item.seedLocalId, cause: error },
        )
      }
    }
  }

  private static async waitForPropertyInstance(
    item: Item<any>,
    propertyName: string,
    timeout: number,
  ): Promise<IItemProperty | undefined> {
    const find = (ctx: any) => {
      const instances = ctx?.propertyInstances as Map<string, IItemProperty> | undefined
      const altKey = getAlternatePropertyNameForInstanceLookup(propertyName)
      return instances?.get(propertyName) ?? (altKey ? instances?.get(altKey) : undefined)
    }
    const existing = find(item.getService().getSnapshot().context)
    if (existing) return existing
    try {
      const snap = await waitFor(item.getService(), (s: any) => !!find(s.context), { timeout })
      return find(snap.context)
    } catch {
      return undefined
    }
  }

  /**
   * Get Item instance by ID from cache
   * The ID can be either seedUid or seedLocalId
   * @param id - seedUid or seedLocalId
   * @returns Cached Item instance or null if not found
   */
  static getById(id: string): Item<any> | null {
    if (!id) {
      return null
    }
    
    const entry = this.findItemInstanceCacheEntryById(id)
    if (entry) {
      entry.refCount += 1
      return entry.instance
    }

    return null
  }

  /**
   * Drop cached Item instances for the given seed local ids / uids without soft-deleting DB rows.
   * Used by local purge (`removeLocalCopiesForAddresses`) before hard-deleting rows.
   */
  static dropCachedInstancesForSeedIds(ids: string[]): void {
    const uniqueIds = [
      ...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0)),
    ]
    const seenInstances = new Set<Item<any>>()

    for (const id of uniqueIds) {
      const entry = this.findItemInstanceCacheEntryById(id)
      if (entry && !seenInstances.has(entry.instance)) {
        seenInstances.add(entry.instance)
        const instance = entry.instance
        const cacheKeys = this.collectInstanceCacheKeysForInstance(instance)

        clearDestroySubscriptions(instance, {
          instanceState: itemInstanceState,
          onUnload: (inst) => (inst as Item<any>)._subscription?.unsubscribe(),
        })

        forceRemoveFromCaches(instance, {
          getCacheKeys: () => cacheKeys,
          caches: [Item.instanceCache as Map<string, unknown>],
        })

        try {
          instance._service.stop()
        } catch {
          // Service may already be stopped
        }
      }

      ItemProperty.clearInstanceCacheForItem(id)
    }
  }

  /**
   * Create Item instance by ID (queries database if not in cache)
   * The ID can be either seedUid or seedLocalId
   * @param id - seedUid or seedLocalId
   * @param modelName - Optional model name for querying
   * @param idKind - 'localId' when the id was given as a seedLocalId: looked up as one first
   * @returns Item instance or undefined if not found
   */
  static async createById(
    id: string,
    modelName?: string,
    idKind?: 'localId',
  ): Promise<Item<any> | undefined> {
    if (!id) {
      return undefined
    }

    // Check cache first
    const cached = this.getById(id)
    if (cached) {
      return cached
    }

    // Try seedUid first, then seedLocalId; local id first when the caller says it's one (a find by
    // seedLocalId), which saves the uid lookup. Either way the other is tried if the first misses.
    const byUid = () => timedDb(`load ${id} item data by uid`, () => getItemData({ modelName, seedUid: id }))
    const byLocalId = () => timedDb(`load ${id} item data by local id`, () => getItemData({ modelName, seedLocalId: id }))
    const itemData = idKind === 'localId'
      ? (await byLocalId()) ?? (await byUid())
      : (await byUid()) ?? (await byLocalId())

    if (!itemData) {
      return undefined
    }

    // Item.create() will handle caching the new instance
    return await timedDb(`load ${id} Item.create`, () => Item.create({
      ...itemData,
      modelName,
    }))
  }

  static async find({
    modelName,
    seedLocalId,
    seedUid,
    waitForReady = true,
    readyTimeout = DEFAULT_READY_TIMEOUT_MS,
  }: ItemFindProps & {
    waitForReady?: boolean
    readyTimeout?: number
  }): Promise<IItem<any> | undefined> {
    if (!seedLocalId && !seedUid) {
      return undefined
    }

    // Prefer local id so cache + findEntity align with Item.instanceCache (local-first, uid alias).
    const id = seedLocalId || seedUid
    if (!id) {
      return undefined
    }

    let cached = false
    try {
      return await timedDb(
        `find ${modelName ?? '?'} ${id}`,
        () =>
          findEntity<Item<any>>(
            {
              getById: (id) => {
                const instance = Item.getById(id) || undefined
                cached = instance !== undefined
                return instance
              },
              createById: async (id) => {
                // Pass modelName to createById if available
                return await Item.createById(id, modelName, seedLocalId ? 'localId' : undefined)
              },
            },
            { id },
            {
              waitForReady,
              readyTimeout,
            }
          ),
        () => (cached ? '(cached)' : '(loaded)'),
      )
    } catch (error) {
      timingLogger(`find ${modelName ?? '?'} ${id} returned undefined: ${error}`)
      return undefined
    }
  }

  static async all(
    modelName?: string,
    deleted?: boolean,
    options?: {
      waitForReady?: boolean
      readyTimeout?: number
      includeEas?: boolean
      addressFilter?: 'owned' | 'watched' | 'all'
      /** Only items of one model, when several schemas define `modelName`: its Model.id ... */
      modelFileId?: string
      /** ... or the schema that defines it. */
      schemaName?: string
      /**
       * Stops building items once aborted and rejects with the signal's reason. Items already
       * built stay loaded.
       */
      signal?: AbortSignal
    },
  ): Promise<Item<any>[]> {
    const {
      waitForReady = false,
      readyTimeout = DEFAULT_READY_TIMEOUT_MS,
      includeEas = false,
      addressFilter,
      modelFileId,
      schemaName,
      signal,
    } = options ?? {}
    signal?.throwIfAborted()
    const itemsData = await getItemsData({ modelName, modelFileId, schemaName, deleted, includeEas, addressFilter })
    const itemInstances: Item<any>[] = []
    // Built without waiting; with waitForReady the items are then awaited together, below.
    for (const itemData of itemsData) {
      signal?.throwIfAborted()
      itemInstances.push(
        await Item.create(
          {
            ...itemData,
            modelName,
          },
          { waitForReady: false },
        ),
      )
    }

    if (waitForReady && itemInstances.length > 0) {
      await Promise.all(
        itemInstances.map((item) =>
          this.waitForItemInstanceReadyForRead(item, readyTimeout),
        ),
      )
    }
    signal?.throwIfAborted()

    return orderBy(itemInstances, ['createdAt'], ['desc'])
  }

  /**
   * After EAS sync writes metadata for the latest version, merge new property instances and
   * re-run DB hydration on cached Items. Item liveQuery watches seeds/versions, not metadata,
   * and useItems may not invalidate when the seed set is unchanged.
   */
  static async rehydrateCachedItemsFromDbAfterEasSync(): Promise<void> {
    const appDb = BaseDb.getAppDb()
    if (!appDb || Item.instanceCache.size === 0) {
      return
    }

    const { metadata } = await import('../seedSchema')
    const { eq, and } = await import('drizzle-orm')

    const dedupedInstances = new Map<Item<any>, { instance: Item<any>; refCount: number }>()
    for (const entry of Item.instanceCache.values()) {
      dedupedInstances.set(entry.instance, entry)
    }
    const entries = [...dedupedInstances.values()]
    await Promise.all(
      entries.map(async ({ instance }) => {
        try {
          const svc = instance.getService()
          if (svc.getSnapshot().status !== 'active') {
            return
          }

          const ctx = svc.getSnapshot().context as any
          const seedLocalId = ctx.seedLocalId as string | undefined
          const seedUid = ctx.seedUid as string | undefined
          const versionLocalId = ctx.latestVersionLocalId as string | undefined
          const itemModelName = ctx.modelName as string | undefined
          const schemaNameForModel = ctx.schemaName as string | undefined
          if (!seedLocalId || !versionLocalId || !itemModelName) {
            return
          }

          const metadataRows = await appDb
            .select({ ...getTableColumns(metadata), propertyKey: metadataPropertyKeyColumn() })
            .from(metadata)
            .where(
              and(
                eq(metadata.seedLocalId, seedLocalId),
                eq(metadata.versionLocalId, versionLocalId),
              ),
            )

          let propertySchemas: Record<string, any> = {}
          try {
            const M = getModel()
            const model =
              M?.resolve(itemModelName, {
                  modelFileId: ctx.modelFileId as string | undefined,
                  schemaName: schemaNameForModel,
                })
            if (model?.properties?.length) {
              propertySchemas = modelPropertiesToObject(model.properties)
            }
          } catch {
            /* Model optional */
          }

          const sendToItemMachine = (event: Parameters<typeof svc.send>[0]) => {
            if (svc.getSnapshot().status !== 'active') {
              return
            }
            svc.send(event)
          }

          for (const metaRow of metadataRows) {
            try {
              const propertyName = metadataRowPropertyKey(metaRow, propertySchemas)
              if (!propertyName) {
                continue
              }
              const property = await ItemProperty.find({
                propertyName,
                seedLocalId,
                seedUid,
                modelName: itemModelName,
                hold: false,
              })
              // The item stopped while the lookup ran: it can't take its hold, so nothing would
              if (property && isActorStopped(svc)) ItemProperty.unloadUnheldForItem([property.seedLocalId, property.seedUid])
              if (property) {
                sendToItemMachine({
                  type: 'addPropertyInstance',
                  propertyName,
                  propertyInstance: property,
                })
              }
            } catch {
              /* row skipped */
            }
          }

          const instances = svc.getSnapshot().context.propertyInstances as
            | Map<string, IItemProperty<any>>
            | undefined
          if (!instances) {
            return
          }
          for (const propertyInstance of instances.values()) {
            try {
              const propertySnap = propertyInstance.getService().getSnapshot()
              if (isMachineSnapshot(propertySnap) && propertySnap.matches('idle')) {
                propertyInstance.getService().send({ type: 'rehydrateFromDb' })
              }
            } catch {
              /* best-effort */
            }
          }
        } catch (e) {
          itemLogger('rehydrateCachedItemsFromDbAfterEasSync item failed:', e)
        }
      }),
    )
  }

  protected _createPropertyInstance(props: Partial<CreatePropertyInstanceProps>) {
    if (this._storageTransactionId) {
      props.storageTransactionId = this._storageTransactionId
    }

    // The item's own hold is taken when the instance enters its map (syncPropertyHolds)
    const propertyInstance = ItemProperty.create(props, {
        waitForReady: false,
        hold: false,
      })

    if (!propertyInstance || !props.propertyName) {
      return
    }

    this._service.send({
      type: 'addPropertyInstance',
      propertyName: props.propertyName,
      propertyInstance,
    })
  }

  /** Same as `item.publish(options)`; requires @seedprotocol/publish. */
  /** Keys Item.create accepts besides the model's properties. */
  private static readonly CREATE_METADATA_KEYS = new Set([
    'modelName', 'schemaName', 'modelInstance', 'modelFileId', 'type',
    'seedLocalId', 'seedUid', 'schemaUid', 'attestationCreatedAt',
    'latestVersionUid', 'latestVersionLocalId', 'publishedVersionUid', 'publishedVersionLocalId',
    'versionsCount', 'lastVersionPublishedAt', 'lastLocalUpdateAt',
    'createdAt', 'updatedAt', 'publisher', 'revokedAt',
  ])

  /** Throws ItemCreateValidationError for unknown keys and values that break their property's rules. */
  private static async assertValidCreateValues(
    props: Record<string, unknown>,
    propertyNames: string[],
    dataTypeByPropertyName: Map<string, string>,
    skipKeys: Set<string>,
  ): Promise<void> {
    const { ItemCreateValidationError } = await import('./errors')
    const { getPropertySchema } = await import('../helpers/property')
    const { SchemaValidationService } = await import('../Schema/service/validation/SchemaValidationService')
    const validationService = new SchemaValidationService()
    const modelName = props.modelName as string
    const known = new Set(propertyNames)
    const problems: import('./errors').ItemCreateProblem[] = []

    for (const [key, value] of Object.entries(props)) {
      if (Item.CREATE_METADATA_KEYS.has(key) || skipKeys.has(key)) continue
      if (!known.has(key)) {
        problems.push({
          property: key,
          code: 'unknown_property',
          message: `${modelName} has no property "${key}"`,
        })
        continue
      }
      if (value === undefined || value === null) continue
      const propertySchema = await getPropertySchema(modelName, key, {
        modelFileId: props.modelFileId as string | undefined,
        schemaName: props.schemaName as string | undefined,
      })
      const dataType = normalizeDataType(propertySchema?.dataType ?? dataTypeByPropertyName.get(key) ?? '')
      if (!dataType) continue
      // Lists may be passed as the JSON array string they are stored as.
      let checked: unknown = value
      if (dataType === ModelPropertyDataTypes.List && typeof value === 'string') {
        try {
          const parsed = JSON.parse(value)
          if (Array.isArray(parsed)) checked = parsed
        } catch {
          // Not JSON: validated as given, and rejected as a non-array
        }
      }
      const { resolvePropertyValidationRules } = await import('../helpers/propertyValidationRules')
      const rules =
        propertySchema?.validation ??
        (await resolvePropertyValidationRules(modelName, key, {
          modelFileId: props.modelFileId as string | undefined,
          schemaName: props.schemaName as string | undefined,
        }))
      const result = validationService.validatePropertyValue(
        checked,
        dataType as ModelPropertyDataTypes,
        rules,
        propertySchema?.refValueType,
      )
      for (const error of result.errors) {
        problems.push({ property: key, code: error.code, message: error.message })
      }
    }

    if (problems.length > 0) {
      throw new ItemCreateValidationError(modelName, problems)
    }
  }

  /**
   * Set `publisher` on loaded Items for these seeds (after claimUnpublishedDrafts stamped
   * their rows). Items that aren't loaded read it from the DB when they load.
   */
  static setPublisherForCachedSeeds(seedLocalIds: readonly string[], publisher: string): void {
    const normalized = normalizePublisher(publisher)
    if (!normalized) return
    for (const seedLocalId of seedLocalIds) {
      // Not getById: that adds a cache hold the caller would never release.
      const item = Item.findItemInstanceCacheEntryById(seedLocalId)?.instance
      if (!item) continue
      const status = item.getService().getSnapshot().status
      if (status === 'stopped' || status === 'done') continue
      item.getService().send({ type: 'updateContext', publisher: normalized })
    }
  }

  static async publish(item: IItem<any>, options?: ItemPublishOptions): Promise<void> {
    await item.publish(options)
  }

  subscribe = (callback: (itemProps: any) => void): Subscription => {
    return this._service.subscribe((snapshot: SnapshotFrom<typeof itemMachineSingle>) => {
      callback(snapshot.context)
    })
  }

  getService = (): ActorRefFrom<typeof itemMachineSingle> => {
    return this._service
  }

  /**
   * The item's unresolved conflicts, one per property: local edits that were kept over a value
   * sync wrote while they were pending (ADR 0019). Each property's is also on `property.conflict`.
   */
  conflicts = async (): Promise<import('@/outbox/conflicts').PropertyConflict[]> => {
    const { getItemConflicts } = await import('@/outbox/conflicts')
    return getItemConflicts(this.seedLocalId)
  }

  getEditedProperties = async (): Promise<PropertyData[]> => {
    return await getItemProperties({
      seedLocalId: this.seedLocalId,
      edited: true,
    })
  }

  unpublish = async (): Promise<void> => {
    const { assertItemOwned } = await import('@/helpers/ownership')
    const { getRevokeExecutor } = await import('@/helpers/publishConfig')
    await assertItemOwned(this)
    const seedUid = this.seedUid
    if (!seedUid) {
      throw new Error('Item is not published. Cannot unpublish.')
    }
    const seedSchemaUid = this.schemaUid
    if (!seedSchemaUid) {
      throw new Error('Item has no schema UID. Cannot unpublish.')
    }
    const revoke = getRevokeExecutor()
    if (!revoke) {
      throw new Error(
        'Revocation is not configured. Call initPublish() from @seedprotocol/publish or ensure PublishProvider is mounted with config.'
      )
    }
    await revoke({
      seedLocalId: this.seedLocalId,
      seedUid,
      seedSchemaUid,
    })
    const revokedAt = Math.floor(Date.now() / 1000)
    // The executor stamps the revoked version rows; the latest version is now the newest one left
    // (a local draft) or none, never a revoked one.
    const head = await getLatestVersionRow(this.seedLocalId)
    this._service.send({
      type: 'updateContext',
      revokedAt,
      latestVersionLocalId: head?.localId ?? undefined,
      latestVersionUid: head?.uid ?? undefined,
    })
  }

  /**
   * Upload this item's files to Arweave and write its attestations to EAS.
   *
   * Requires @seedprotocol/publish. Its `initPublish()` (or `<PublishProvider config>`)
   * registers the PublishExecutor this delegates to; without it, publish() throws
   * PUBLISH_NOT_CONFIGURED_MESSAGE. `options` are passed to that package unchanged (its
   * CreatePublishOptions: signers, Arweave tags, `publishMode`, `onPublished`, ...).
   *
   * Resolves when the publish has finished, and rejects with the publish package's error
   * if it failed. Throws OwnershipError if none of the client's addresses own the item.
   */
  publish = async (options?: ItemPublishOptions): Promise<void> => {
    const { assertItemOwned } = await import('@/helpers/ownership')
    const { getPublishExecutor, PUBLISH_NOT_CONFIGURED_MESSAGE } = await import('@/helpers/publishConfig')
    await assertItemOwned(this)
    if (!getPublishExecutor()) {
      throw new Error(PUBLISH_NOT_CONFIGURED_MESSAGE)
    }
    const current = this._service.getSnapshot().value as string
    if (current !== 'idle') {
      throw new Error(
        current === 'publishing'
          ? 'Item is already being published.'
          : `Item is not ready to publish (state: ${current}).`,
      )
    }
    return new Promise<void>((resolve, reject) => {
      // Subscribe before sending: subscribe() does not replay the current snapshot,
      // so a subscription made after startPublish could miss the 'publishing' state.
      let wasPublishing = false
      const unsub = this._service.subscribe((snapshot: SnapshotFrom<typeof itemMachineSingle>) => {
        const value = snapshot.value as string
        if (value === 'publishing') {
          wasPublishing = true
          return
        }
        if (value === 'idle' && wasPublishing) {
          unsub.unsubscribe()
          const { _publishError: publishError } = snapshot.context
          if (publishError) {
            reject(publishError)
          } else {
            resolve()
          }
        }
      })
      // The executor assigns item.seedUid, which only the proxy accepts.
      const item = reactiveProxies.get(this._service) ?? this
      this._service.send({ type: 'startPublish', item, options })
    })
  }

  getPublishUploads = async (
    options?: import('../db/read/getPublishUploads').GetPublishUploadsOptions,
  ) => {
    // Use dynamic import to break circular dependency
    const getPublishUploadsMod = await import('../db/read/getPublishUploads')
    const { getPublishUploads } = getPublishUploadsMod
    return await getPublishUploads(this, [], undefined, options)
  }

  getPublishPayload = async (
    uploadedTransactions: any[],
    options?: import('../db/read/getPublishPayload').GetPublishPayloadOptions,
  ) => {
    const getPublishPayloadMod = await import('../db/read/getPublishPayload')
    const { getPublishPayload } = getPublishPayloadMod
    return await getPublishPayload(this, uploadedTransactions, options)
  }

  persistSeedUid = async (publisher?: string, attestationCreatedAtMs?: number): Promise<void> => {
    const ctx = this._getSnapshotContext()
    const seedLocalId = ctx.seedLocalId
    const seedUid = ctx.seedUid
    if (seedLocalId && seedUid && typeof seedUid === 'string' && seedUid.length > 0) {
      await updateSeedUid({
        seedLocalId,
        seedUid,
        publisher,
        ...(attestationCreatedAtMs != null && { attestationCreatedAt: attestationCreatedAtMs }),
      })
      // Publish has recorded the version it attested (updateVersionUid): reflect it here too, as
      // the versions liveQuery does in the browser. After a republish this is the new version.
        const head = await getLatestVersionRow(seedLocalId)
      if (head?.localId) {
        this._service.send({
          type: 'updateContext',
          latestVersionLocalId: head.localId,
          latestVersionUid: head.uid ?? undefined,
        })
      }
    }
  }

  get serviceContext() {
    const snapshot = this._service.getSnapshot()
    return (snapshot as any).context || {}
  }

  /**
   * Get snapshot context from the service
   * Used by the reactive proxy to read tracked properties
   */
  _getSnapshotContext() {
    return (this._service.getSnapshot() as SnapshotFrom<typeof itemMachineSingle>).context
  }

  // These getters are now handled by the reactive proxy
  // They read from the service context via the proxy
  // Keeping them for backward compatibility, but they delegate to serviceContext
  get seedLocalId(): string {
    return this.serviceContext.seedLocalId as string
  }

  get seedUid(): string | undefined {
    return this.serviceContext.seedUid
  }

  get schemaUid(): string | undefined {
    return this.serviceContext.schemaUid
  }

  get latestVersionUid(): VersionsType {
    return this.serviceContext.latestVersionUid as VersionsType
  }

  get latestVersionLocalId(): string {
    return this.serviceContext.latestVersionLocalId as string
  }

  get modelName(): string {
    return this.serviceContext.modelName as string
  }

  get publisher(): string | undefined {
    return this.serviceContext.publisher
  }

  get revokedAt(): number | undefined {
    return this.serviceContext.revokedAt
  }

  get isRevoked(): boolean {
    const revokedAt = this.serviceContext.revokedAt
    return typeof revokedAt === 'number' && revokedAt > 0
  }

  /**
   * Returns model property names from the Model cache (for use in constructor when
   * property instances are not yet available). Returns [] if modelName is missing
   * or Model is not in cache. Pass schemaName when available so the correct model
   * is resolved (cache is keyed by schemaName:modelName).
   */
  protected _getModelPropertyNames(schemaName?: string): string[] {
    try {
      const Model = getModel()
      const modelName = this.modelName
      if (!modelName) {
        return []
      }
      const model = Model.resolve(modelName, {
        modelFileId: this.serviceContext.modelFileId,
        schemaName: schemaName ?? this.serviceContext.schemaName,
      })
      if (!model) {
        return []
      }
      const modelProperties = model.properties || []
      if (modelProperties.length === 0) {
        return []
      }
      const names: string[] = []
      for (const modelProperty of modelProperties) {
        const propContext = modelProperty._getSnapshotContext()
        const propertyName = propContext.name
        if (propertyName && !INTERNAL_PROPERTY_NAMES.includes(propertyName)) {
          if (!names.includes(propertyName)) {
            names.push(propertyName)
          }
        }
      }
      return names
    } catch {
      return []
    }
  }

  /**
   * Helper method to get model schema keys for filtering properties
   * Since properties are loaded from metadata (which already corresponds to the model),
   * we can infer schema keys from the property instances themselves
   * This makes Item independent from Model
   */
  protected _getModelSchemaKeys(): string[] {
    // Get model schema keys - prefer property instances since they come from the database
    // and are already filtered to the correct model. Fall back to Model if property instances
    // aren't available yet.
    const serviceContext = this.serviceContext
    const propertyInstances = serviceContext.propertyInstances as Map<string, IItemProperty> | undefined
    const modelName = this.modelName
    
    // First, try to get schema keys from property instances (most reliable)
    // Property instances come from the database and are already model-specific
    if (propertyInstances && propertyInstances.size > 0) {
      const schemaKeys = this._getSchemaKeysFromPropertyInstances(propertyInstances)
      if (schemaKeys.length > 0) {
        return schemaKeys
      }
    }
    
    // Fall back to Model if property instances aren't available yet
    try {
      const Model = getModel()
      if (!modelName) {
        return []
      }
      
      const model = Model.resolve(modelName, {
        modelFileId: serviceContext.modelFileId,
        schemaName: serviceContext.schemaName,
      })
      if (!model) {
        return []
      }
      
      // Get property names from Model.properties
      const modelProperties = model.properties || []
      if (modelProperties.length === 0) {
        return []
      }
      
      const schemaKeys: string[] = []
      for (const modelProperty of modelProperties) {
        const propContext = modelProperty._getSnapshotContext()
        const propertyName = propContext.name
        if (propertyName && !INTERNAL_PROPERTY_NAMES.includes(propertyName)) {
          if (!schemaKeys.includes(propertyName)) {
            schemaKeys.push(propertyName)
          }
        }
      }
      
      return schemaKeys
    } catch {
      // If Model access fails, return empty array (property instances should be used instead)
      return []
    }
  }
  
  protected _getSchemaKeysFromPropertyInstances(propertyInstances: Map<string, IItemProperty> | undefined): string[] {
    if (!propertyInstances || propertyInstances.size === 0) {
      return []
    }
    
    const schemaKeys: string[] = []
    for (const [key, propertyInstance] of propertyInstances) {
      // Skip internal properties
      if (INTERNAL_PROPERTY_NAMES.includes(key)) {
        continue
      }
      
      // Prefer propertyInstance.propertyName if available (most reliable)
      // Otherwise use the Map key
      const propertyName = propertyInstance.propertyName || key
      
      const transformedKey = toItemPropertyKey(propertyName, propertyInstance.alias)
      if (!schemaKeys.includes(transformedKey)) {
        schemaKeys.push(transformedKey)
      }
    }
    return schemaKeys
  }

  /**
   * Helper method to determine if a property key is a model-specific property
   * (as opposed to an internal/common property)
   *
   * Uses the same transformation as _getSchemaKeysFromPropertyInstances so that
   * Map keys (e.g. "authorId", "tagIds") are correctly matched to schema keys
   * (e.g. "author", "tags").
   */
  protected _isModelProperty(key: string, modelSchemaKeys: string[]): boolean {
    // Include if in model schema (even when in INTERNAL_PROPERTY_NAMES, e.g. Image.storageTransactionId)
    if (modelSchemaKeys.includes(key)) {
      return true
    }
    if (INTERNAL_PROPERTY_NAMES.includes(key)) {
      return false
    }
    const propertyInstances = this.serviceContext.propertyInstances as Map<string, IItemProperty> | undefined
    if (!propertyInstances) {
      return false
    }
    const propertyInstance = propertyInstances.get(key)
    if (!propertyInstance) {
      return false
    }
    // Same key as _getSchemaKeysFromPropertyInstances
    const propertyName = propertyInstance.propertyName || key
    return modelSchemaKeys.includes(toItemPropertyKey(propertyName, propertyInstance.alias))
  }

  /**
   * Returns only properties that are defined in the Model's schema
   * (excludes internal/common properties)
   */
  get properties(): IItemProperty[] {
    const serviceContext = this.serviceContext
    const propertyInstances = serviceContext.propertyInstances as Map<string, IItemProperty> | undefined
    
    if (!propertyInstances || propertyInstances.size === 0) {
      return []
    }
    
    // Get model schema keys for filtering
    const modelSchemaKeys = this._getModelSchemaKeys()
    
    // Convert Map to array, filtering by model schema
    const properties: IItemProperty[] = []
    for (const [key, propertyInstance] of propertyInstances) {
      // Skip internal properties unless they're in the model schema (e.g. Image.storageTransactionId)
      if (INTERNAL_PROPERTY_NAMES.includes(key) && !modelSchemaKeys.includes(key)) {
        continue
      }

      // Include if it's a model property
      const isModelProp = this._isModelProperty(key, modelSchemaKeys)
      if (isModelProp) {
        properties.push(propertyInstance)
      }
    }
    
    // Always return new array reference for React reactivity
    return [...properties]
  }

  /**
   * Returns only internal/common properties that are shared across all Items
   * (e.g., seedLocalId, seedUid, createdAt, etc.)
   */
  get internalProperties(): Record<string, IItemProperty> {
    const allProps = this._propertiesSubject.value
    return Object.fromEntries(
      Object.entries(allProps).filter(([key]) =>
        INTERNAL_PROPERTY_NAMES.includes(key)
      )
    )
  }

  /**
   * Returns all properties (both model-specific and internal)
   * Useful for backward compatibility or debugging
   */
  get allProperties(): Record<string, IItemProperty> {
    return this._propertiesSubject.value
  }

  get attestationCreatedAt(): number {
    return this.serviceContext.attestationCreatedAt as number
  }

  get versionsCount(): number {
    return this.serviceContext.versionsCount as number
  }

  get lastVersionPublishedAt(): number {
    return this.serviceContext.lastVersionPublishedAt as number
  }

  get createdAt(): number | undefined {
    // Try to get from serviceContext first
    if (this.serviceContext.createdAt !== undefined) {
      return this.serviceContext.createdAt as number
    }
    // Try to get from allProperties if it exists as a property
    const createdAtProp = this.allProperties.createdAt
    if (createdAtProp) {
      return createdAtProp.value as number | undefined
    }
    return undefined
  }

  /**
   * Set up liveQuery subscription to watch for item and version changes in the database
   * This enables cross-instance synchronization (e.g., changes in other tabs/windows)
   */
  private _setupLiveQuerySubscription(): void {
    const isBrowser = typeof window !== 'undefined'
    const logger = debug('seedSdk:item:liveQuery')
    
    // Use a closure variable to track setup state per instance
    const setupState = { subscriptionSetUp: false }

    const setupLiveQuery = async (seedLocalId: string, seedUid?: string) => {
      if (setupState.subscriptionSetUp) {
        return
      }

      setupState.subscriptionSetUp = true
      logger(`[Item._setupLiveQuerySubscription] Setting up liveQuery for seedLocalId: ${seedLocalId}`)
      const timingStart = timingNow()

      const itemActor = this._service
      const sendToItemMachine = (event: Parameters<typeof itemActor.send>[0]) => {
        const status = itemActor.getSnapshot().status
        if (status === 'stopped' || status === 'done') {
          return
        }
        itemActor.send(event)
      }

      try {
        const seedSchemaMod = await import('../seedSchema')
        const { seeds, metadata } = seedSchemaMod
        const drizzleMod = await import('drizzle-orm')
        const { eq, and } = drizzleMod
        const versionDataMod = await import('../db/read/subqueries/versionData')
        const { getVersionData } = versionDataMod
        
        const db = BaseDb.getAppDb()
        if (!db) {
          logger('[Item._setupLiveQuerySubscription] Database not available')
          return
        }

        // Query initial seed and version data
        const { findSeedRow } = await import('../db/read/findSeedRow')
        const seed = await findSeedRow({ localId: seedLocalId, uid: seedUid }, db)
        if (!seed) {
          logger(`[Item._setupLiveQuerySubscription] Seed not found for seedLocalId: ${seedLocalId}`)
          return
        }
        const versionData = getVersionData()
        const seedRecords = await db
          .with(versionData)
          .select({
            seedLocalId: seeds.localId,
            seedUid: seeds.uid,
            schemaUid: seeds.schemaUid,
            latestVersionUid: versionData.latestVersionUid,
            latestVersionLocalId: versionData.latestVersionLocalId,
            versionsCount: versionData.versionsCount,
          })
          .from(seeds)
          .leftJoin(versionData, eq(seeds.localId, versionData.seedLocalId))
          .where(eq(seeds.localId, seed.localId))
          .limit(1)

        if (seedRecords.length === 0) {
          logger(`[Item._setupLiveQuerySubscription] Seed not found for seedLocalId: ${seedLocalId}`)
          return
        }

        const seedRecord = seedRecords[0]
        // Set up from a uid alone, the item's local id comes from its seed row.
        const watchedSeedLocalId = seedRecord.seedLocalId || seedLocalId
        const currentVersionLocalId = seedRecord.latestVersionLocalId

        // A seed whose versions are all revoked (unpublished) has no latest version, but its versions
        // are still watched below so a new version (republish, new draft) is picked up.
        if (!currentVersionLocalId && !seedRecord.versionsCount) {
          logger(`[Item._setupLiveQuerySubscription] No version found for seedLocalId: ${seedLocalId}`)
          return
        }

        // In the browser the versions liveQuery below emits at once and its handler runs this same
        // metadata read and property setup, so only Node (no liveQuery) does it here.
        if (currentVersionLocalId && !isBrowser) {
          // Query initial metadata records for the latest version
          const initialMetadata = await db
            .select()
            .from(metadata)
            .where(
              and(
                eq(metadata.seedLocalId, watchedSeedLocalId),
                eq(metadata.versionLocalId, currentVersionLocalId)
              )
            )

          const initialMetadataIds = initialMetadata
            .map((row: any) => row.localId || row.uid)
            .filter((id: string | null | undefined): id is string => Boolean(id))

          logger(`[Item._setupLiveQuerySubscription] Initial query returned ${initialMetadataIds.length} metadata records`)

          // CRITICAL: Create ItemProperty instances BEFORE updating context
          if (initialMetadataIds.length > 0) {
            try {
              const itemPropertyMod = await import('../ItemProperty/ItemProperty')
              const { ItemProperty } = itemPropertyMod
              const itemModelName = this._service.getSnapshot().context.modelName
              const createPromises = initialMetadata.map(async (metaRow: any) => {
                try {
                  const property = await ItemProperty.find({
                    propertyName: metaRow.propertyName,
                    seedLocalId: watchedSeedLocalId,
                    seedUid: this._getSnapshotContext().seedUid ?? seedUid,
                    modelName: itemModelName,
                    hold: false,
                  })
                  // The item stopped while the lookup ran: it can't take its hold, so nothing would
                  if (property && isActorStopped(this._service)) ItemProperty.unloadUnheldForItem([property.seedLocalId, property.seedUid])
                  if (property) {
                    logger(`[Item._setupLiveQuerySubscription] Created/cached ItemProperty instance for propertyName "${metaRow.propertyName}"`)
                  }
                } catch (error) {
                  logger(`[Item._setupLiveQuerySubscription] Error creating ItemProperty instance: ${error}`)
                }
              })
              await Promise.all(createPromises)
            } catch (error) {
              logger(`[Item._setupLiveQuerySubscription] Error importing ItemProperty or creating instances: ${error}`)
            }
          }

          // Update context with latest version info
          sendToItemMachine({
            type: 'updateContext',
            latestVersionLocalId: currentVersionLocalId,
            latestVersionUid: seedRecord.latestVersionUid,
          })
        }

        // Only watch for changes in the browser (the change feed is browser-only)
        if (isBrowser) {
          // Watch the seed row by local id: its uid changes when an unpublished item is published
          // again (a new seed attestation), and a watch on the uid would stop seeing the row.
          type SeedRow = {
            localId: string
            uid: string | null
            schemaUid: string | null
            revokedAt: number | null
            publisher: string | null
            attestationCreatedAt: number | null
          }
          const seedsQuery = (sql: any) => sql`
              SELECT local_id as localId, uid, schema_uid as schemaUid, revoked_at as revokedAt, publisher,
                attestation_created_at as attestationCreatedAt
              FROM seeds
              WHERE local_id = ${watchedSeedLocalId}
            `

          // Watch the versions table for this seed
          type VersionRow = {
            localId: string
            uid: string | null
            seedLocalId: string
            revokedAt: number | null
            attestationCreatedAt: number | null
          }
          // The tag binds every interpolation as a parameter, so the order goes in the strings.
          const versionsQueryText = [
            `SELECT local_id as localId, uid, seed_local_id as seedLocalId, revoked_at as revokedAt,
                attestation_created_at as attestationCreatedAt
              FROM versions
              WHERE seed_local_id = `,
            ` ORDER BY ${LATEST_VERSION_ORDER_SQL}`,
          ]
          const versionsQuery = (sql: any) =>
            sql(Object.assign([...versionsQueryText], { raw: versionsQueryText }), watchedSeedLocalId)

          const instanceState = itemInstanceState.get(this)
          if (!instanceState) {
            logger('[Item._setupLiveQuerySubscription] Instance state not found')
            return
          }

          // Unloaded or destroyed while setup awaited: watching now would leak the watches.
          if (isActorStopped(this._service)) return

          // Re-read the seed row and the versions on each change to them (ADR 0020). Both run once
          // now too, as the liveQueries' first emissions did: the versions handler adds the
          // property instances to the item's context.
          const seedsSubscription = watchEntityRows<SeedRow[]>(
            { seedLocalId: watchedSeedLocalId, tables: ['seeds'] },
            () => queryEntityRows<SeedRow>(seedsQuery),
            async (seedRows) => {
              if (seedRows.length === 0) return
              
              const seedRow = seedRows[0]
              logger(`[Item._setupLiveQuerySubscription] Seed updated in database`)
              
              // Update context with seed data
              const status = itemActor.getSnapshot().status
              if (status === 'stopped' || status === 'done') return
              // The row still has a uid this item moved away from (a republish set the new seed uid
              // on the item; its DB write has not landed): stale, so neither its uid nor its
              // revocation applies. Once the row has the item's uid, the DB has caught up.
              const rowUid = seedRow.uid?.toLowerCase()
              const superseded = supersededSeedUids.get(this._service)
              if (rowUid && superseded?.has(rowUid)) {
                logger('[Item._setupLiveQuerySubscription] Ignoring seed row with a superseded uid')
                return
              }
              if (rowUid && rowUid === this._getSnapshotContext().seedUid?.toLowerCase()) {
                superseded?.clear()
              }
              // A new uid written elsewhere (sync, another tab's republish) goes through the tracked
              // setter so the instance cache's uid alias follows it. A row without a uid (not yet
              // persisted) never clears the item's uid.
              if (seedRow.uid && seedRow.uid !== this._getSnapshotContext().seedUid) {
                Item.sendTrackedPropertyUpdate(this, 'seedUid', seedRow.uid)
              }
              sendToItemMachine({
                type: 'updateContext',
                seedLocalId: seedRow.localId,
                schemaUid: seedRow.schemaUid || undefined,
                revokedAt: seedRow.revokedAt ?? undefined,
                // claimUnpublishedDrafts (here or in another tab) stamps drafts' publisher.
                ...(seedRow.publisher ? { publisher: seedRow.publisher } : {}),
                // Written by publish (persistSeedUid) after the item took its uid.
                ...(seedRow.attestationCreatedAt ? { attestationCreatedAt: seedRow.attestationCreatedAt } : {}),
              })
            },
            {
              immediate: true,
              onError: (error) => logger(`[Item._setupLiveQuerySubscription] Seeds read error: ${error}`),
            },
          )

          let versionsRuns = 0
          const versionsSubscribedAt = timingNow()
          const versionsSubscription = watchEntityRows<VersionRow[]>(
            { seedLocalId: watchedSeedLocalId, tables: ['versions'] },
            () => queryEntityRows<VersionRow>(versionsQuery),
            async (versionRows) => {
              const versionsRun = ++versionsRuns
              const runStart = timingNow()
              if (versionsRun === 1 && timingLogger.enabled) {
                timingLogger(
                  `item ${watchedSeedLocalId} versions read first result ${timingSince(versionsSubscribedAt)}ms after watching, ${timingSince(timingStart)}ms after watch setup began`,
                )
              }
              if (versionRows.length === 0) return

              // Get the most recent version that isn't revoked. When every version is revoked (the
              // item was unpublished) there is no latest version any more.
              const latestVersion = versionRows.find((v) => !isVersionRevoked(v.revokedAt))
              if (!latestVersion) {
                sendToItemMachine({
                  type: 'updateContext',
                  latestVersionLocalId: undefined,
                  latestVersionUid: undefined,
                  lastVersionPublishedAt: undefined,
                })
                return
              }
              // As versionData computes it: the newest attestation among the live versions.
              let lastVersionPublishedAt: number | undefined
              for (const v of versionRows) {
                if (isVersionRevoked(v.revokedAt) || !v.attestationCreatedAt) continue
                lastVersionPublishedAt = Math.max(lastVersionPublishedAt ?? 0, v.attestationCreatedAt)
              }
              const latestVersionLocalId = latestVersion.localId
              
              logger(`[Item._setupLiveQuerySubscription] Versions updated, latest version: ${latestVersionLocalId}`)
              
              // Query metadata for the latest version
              const metadataRows = await db
                .select({ ...getTableColumns(metadata), propertyKey: metadataPropertyKeyColumn() })
                .from(metadata)
                .where(
                  and(
                    eq(metadata.seedLocalId, watchedSeedLocalId),
                    eq(metadata.versionLocalId, latestVersionLocalId)
                  )
                )

              // CRITICAL: Create ItemProperty instances BEFORE updating context
              if (metadataRows.length > 0) {
                try {
                  const itemPropertyMod = await import('../ItemProperty/ItemProperty')
                  const { ItemProperty } = itemPropertyMod
                  const itemModelName = this._service.getSnapshot().context.modelName
                  const schemaNameForModel = this._service.getSnapshot().context.schemaName
                  let propertySchemas: Record<string, any> = {}
                  try {
                    if (itemModelName) {
                      const M = getModel()
                      const model =
                        M?.resolve(itemModelName, {
                            modelFileId: this._service.getSnapshot().context.modelFileId,
                            schemaName: schemaNameForModel,
                          })
                      if (model?.properties?.length) {
                        propertySchemas = modelPropertiesToObject(model.properties)
                      }
                    }
                  } catch {
                    // Model not loaded
                  }
                  const createPromises = metadataRows.map(async (metaRow: any) => {
                    try {
                      const propertyName = metadataRowPropertyKey(metaRow, propertySchemas)
                      if (!propertyName) return
                      const property = await ItemProperty.find({
                        propertyName,
                        seedLocalId: watchedSeedLocalId,
                        seedUid: this._getSnapshotContext().seedUid ?? seedUid,
                        modelName: itemModelName,
                        hold: false,
                      })
                      // The item stopped while the lookup ran: it can't take its hold, so nothing would
                      if (property && isActorStopped(this._service)) ItemProperty.unloadUnheldForItem([property.seedLocalId, property.seedUid])
                      if (property) {
                        sendToItemMachine({
                          type: 'addPropertyInstance',
                          propertyName,
                          propertyInstance: property,
                        })
                        logger(`[Item._setupLiveQuerySubscription] Created/cached ItemProperty instance for propertyName "${propertyName}" from liveQuery`)
                      }
                    } catch (error) {
                      logger(`[Item._setupLiveQuerySubscription] Error creating ItemProperty instance: ${error}`)
                    }
                  })
                  await Promise.all(createPromises)
                  if (timingLogger.enabled) {
                    timingLogger(
                      `item ${watchedSeedLocalId} versions run ${versionsRun}: metadata read + ${metadataRows.length} ItemProperty.find ${timingSince(runStart)}ms`,
                    )
                  }
                } catch (error) {
                  logger(`[Item._setupLiveQuerySubscription] Error importing ItemProperty or creating instances from liveQuery: ${error}`)
                }
              }
              
              // Update context with latest version info
              sendToItemMachine({
                type: 'updateContext',
                latestVersionLocalId,
                latestVersionUid: latestVersion.uid || undefined,
                lastVersionPublishedAt,
              })
            },
            {
              immediate: true,
              onError: (error) => logger(`[Item._setupLiveQuerySubscription] Versions read error: ${error}`),
            },
          )

          // Store combined subscription
          instanceState.liveQuerySubscription = {
            unsubscribe: () => {
              seedsSubscription.unsubscribe()
              versionsSubscription.unsubscribe()
            }
          }
          
          logger(`[Item._setupLiveQuerySubscription] LiveQuery subscription set up for seedLocalId: ${seedLocalId}`)
        } else {
          logger(`[Item._setupLiveQuerySubscription] Skipping liveQuery subscription in Node.js environment`)
        }
      } catch (error) {
        logger(`[Item._setupLiveQuerySubscription] Error setting up subscription: ${error}`)
        setupState.subscriptionSetUp = false // Reset on error so we can retry
      }
    }

    // Set up liveQuery subscription as soon as we have seedLocalId
    const setupSubscription = this._service.subscribe(async (snapshot: SnapshotFrom<typeof itemMachineSingle>) => {
      const seedLocalId = snapshot.context.seedLocalId
      const seedUid = snapshot.context.seedUid
      
      if (!seedLocalId && !seedUid) {
        return // Need seed ID to proceed
      }

      // Once we have seed ID, set up the liveQuery subscription (only once)
      if ((seedLocalId || seedUid) && !setupState.subscriptionSetUp) {
        await setupLiveQuery(seedLocalId || '', seedUid)
        if (setupState.subscriptionSetUp) {
          setupSubscription.unsubscribe()
        }
      }
    })
    
    // Also check current state immediately in case seedLocalId is already available
    const currentSnapshot = this._service.getSnapshot() as SnapshotFrom<typeof itemMachineSingle>
    if ((currentSnapshot.context.seedLocalId || currentSnapshot.context.seedUid) && !setupState.subscriptionSetUp) {
      setupLiveQuery(currentSnapshot.context.seedLocalId || '', currentSnapshot.context.seedUid || undefined).catch((error) => {
        logger(`[Item._setupLiveQuerySubscription] Error in immediate setup: ${error}`)
      })
    }
  }

  /**
   * Releases this holder's reference. Item.create, Item.find and createById return the same cached
   * instance to every caller, so the instance is stopped only when the last holder unloads it.
   */
  unload(): void {
    try {
      // Others (e.g. another hook showing the same item) still use it: keep it running.
      if (Item.releaseItemInstanceCacheHold(this)) return
      unloadEntity(this, {
        getCacheKeys: () => [],
        caches: [],
        instanceState: itemInstanceState,
        getService: (instance) => instance._service,
        onUnload: (instance) => {
          // Clean up additional subscription
          instance._subscription?.unsubscribe()
        },
      })
    } catch {
      // Still try to clean up what we can
      const instanceState = itemInstanceState.get(this)
      if (instanceState?.liveQuerySubscription) {
        instanceState.liveQuerySubscription.unsubscribe()
        instanceState.liveQuerySubscription = null
      }
      this._subscription?.unsubscribe()
      try {
        this._service.stop()
      } catch {
        // Service might already be stopped
      }
    }
  }

  /**
   * Destroy the item: soft delete in DB, remove from caches, clean up subscriptions, stop service.
   */
  async destroy(): Promise<void> {
    const { assertItemOwned } = await import('@/helpers/ownership')
    await assertItemOwned(this)
    const context = this._getSnapshotContext()
    const cacheKeys = Item.collectInstanceCacheKeysForInstance(this)

    clearDestroySubscriptions(this, {
      instanceState: itemInstanceState,
      onUnload: (instance) => (instance as Item<any>)._subscription?.unsubscribe(),
    })

    forceRemoveFromCaches(this, {
      getCacheKeys: () => cacheKeys,
      caches: [Item.instanceCache as Map<string, unknown>],
    })

    await runDestroyLifecycle(this, {
      getService: (instance) =>
        instance._service as { send: (ev: unknown) => void; stop: () => void },
      doDestroy: async () => {
        if (!context.seedLocalId) {
          await deleteItem({ seedUid: context.seedUid })
          return
        }
        // Through the outbox (ADR 0019): after the item's pending edits, not before them
        const { appendOutboxOpAndWait, startItemOutbox, throwItemWriteError } = await import('@/outbox')
        startItemOutbox()
        await appendOutboxOpAndWait({
          seedLocalId: context.seedLocalId,
          kind: 'delete',
          value: { mode: 'item' } satisfies import('@/outbox').DeleteOp,
        }).catch(throwItemWriteError)
      },
    })
  }
}
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Subscription, SnapshotFrom } from 'xstate'
import debug from 'debug'
import { ItemProperty } from '@/ItemProperty/ItemProperty'
import { useIsClientReady } from './client'
import { IItemProperty } from '@/interfaces'
import { useLiveQuery } from './liveQuery'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata } from '@/seedSchema/MetadataSchema'
import { seeds } from '@/seedSchema'
import { and, eq, isNotNull } from 'drizzle-orm'
import { getMetadataLatest } from '@/db/read/subqueries/metadataLatest'
import { propertyMachine } from '@/ItemProperty/service/propertyMachine'
import { startCase } from 'lodash-es'

const logger = debug('seedSdk:react:property')
const propertiesLogger = debug('seedSdk:react:itemProperties')

type ItemPropertySnapshot = SnapshotFrom<typeof propertyMachine>

type UseItemPropertyReturn = {
  property: IItemProperty | undefined
  isLoading: boolean
  error: Error | null
}

/**
 * Hook to get a specific ItemProperty instance
 * Can be called in multiple ways:
 * 1. With seedLocalId/seedUid and propertyName: useItemProperty({ seedLocalId, propertyName }) or useItemProperty({ seedUid, propertyName })
 * 2. With itemId and propertyName: useItemProperty(itemId, propertyName)
 * 
 * @overload
 * @param props - Object with seedLocalId or seedUid, and propertyName
 * @returns Object with property, isLoading, and error
 * 
 * @overload
 * @param itemId - The item ID (seedLocalId or seedUid)
 * @param propertyName - The name of the property
 * @returns Object with property, isLoading, and error
 */
export function useItemProperty(props: {
  seedLocalId?: string
  seedUid?: string
  propertyName: string
}): UseItemPropertyReturn
export function useItemProperty(
  itemId: string,
  propertyName: string
): UseItemPropertyReturn
export function useItemProperty(
  arg1: { seedLocalId?: string; seedUid?: string; propertyName: string } | string,
  arg2?: string
) {
  const isClientReady = useIsClientReady()
  const [property, setProperty] = useState<IItemProperty | undefined>(undefined)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const subscriptionRef = useRef<Subscription | undefined>(undefined)
  const [, setVersion] = useState(0) // Version counter to force re-renders

  // Determine which lookup mode we're in based on arguments
  const lookupMode = useMemo(() => {
    if (typeof arg1 === 'string' && arg2 !== undefined) {
      // Two arguments: itemId, propertyName
      return { type: 'itemId' as const, itemId: arg1, propertyName: arg2 }
    } else if (typeof arg1 === 'object') {
      // Object argument: { seedLocalId/seedUid, propertyName }
      return {
        type: 'identifiers' as const,
        seedLocalId: arg1.seedLocalId,
        seedUid: arg1.seedUid,
        propertyName: arg1.propertyName,
      }
    } else {
      return null
    }
  }, [arg1, arg2])

  // Determine initial loading state
  const initialLoadingState = useMemo(() => {
    if (!lookupMode) return false
    if (lookupMode.type === 'itemId') {
      return !!(lookupMode.itemId && lookupMode.propertyName)
    } else {
      return !!(
        (lookupMode.seedLocalId || lookupMode.seedUid) &&
        lookupMode.propertyName
      )
    }
  }, [lookupMode])

  // Determine if we should be loading based on parameters
  const shouldLoad = useMemo(() => {
    if (!isClientReady) return false
    if (!lookupMode) return false
    if (lookupMode.type === 'itemId') {
      return !!(lookupMode.itemId && lookupMode.propertyName)
    } else {
      return !!(
        (lookupMode.seedLocalId || lookupMode.seedUid) &&
        lookupMode.propertyName
      )
    }
  }, [isClientReady, lookupMode])

  const updateItemProperty = useCallback(async () => {
    if (!isClientReady || !lookupMode) {
      setProperty(undefined)
      setIsLoading(false)
      setError(null)
      return
    }

    try {
      setIsLoading(true)
      setError(null)

      let seedLocalId: string | undefined
      let seedUid: string | undefined

      if (lookupMode.type === 'itemId') {
        // Resolve itemId to seedLocalId/seedUid
        // For now, assume itemId is seedLocalId (could be enhanced to support seedUid)
        seedLocalId = lookupMode.itemId
      } else {
        seedLocalId = lookupMode.seedLocalId
        seedUid = lookupMode.seedUid
      }

      if (!seedLocalId && !seedUid) {
        setProperty(undefined)
        setIsLoading(false)
        setError(null)
        return
      }

      const foundProperty = await ItemProperty.find({
        propertyName: lookupMode.propertyName,
        seedLocalId,
        seedUid,
      })

      if (!foundProperty) {
        logger(
          `[useItemProperty] [updateItemProperty] no property found for Item.${seedLocalId || seedUid}.${lookupMode.propertyName}`,
        )
        setProperty(undefined)
        setIsLoading(false)
        setError(null)
        return
      }

      // Check if property is in 'waitingForDb' state and trigger load
      const snapshot = foundProperty.getService().getSnapshot()
      if (snapshot.value === 'waitingForDb') {
        foundProperty.getService().send({ type: 'waitForDbSuccess' })
      }

      setProperty(foundProperty)
      
      // Set loading state based on service state
      // Use type guard to check if snapshot has 'value' property
      if (snapshot && typeof snapshot === 'object' && 'value' in snapshot) {
        const isIdle = snapshot.value === 'idle'
        setIsLoading(!isIdle)
        setError(null)
      } else {
        setIsLoading(false)
        setError(null)
      }
    } catch (error) {
      logger('[useItemProperty] Error updating item property:', error)
      setProperty(undefined)
      setIsLoading(false)
      setError(error as Error)
    }
  }, [isClientReady, lookupMode])

  // Fetch/refetch when lookup parameters change or client becomes ready
  useEffect(() => {
    if (!shouldLoad) {
      setProperty(undefined)
      setIsLoading(false)
      setError(null)
      return
    }
    updateItemProperty()
  }, [shouldLoad, updateItemProperty])

  // Subscribe to service changes when property is available
  useEffect(() => {
    if (!property) {
      // Clean up subscription if property is not available
      subscriptionRef.current?.unsubscribe()
      subscriptionRef.current = undefined
      return
    }

    // Clean up previous subscription
    subscriptionRef.current?.unsubscribe()

    // Subscribe to service changes
    const subscription = property.getService().subscribe((snapshot: any) => {
      // Update loading state based on service state
      // Use type guard to check if snapshot has 'value' property
      if (snapshot && typeof snapshot === 'object' && 'value' in snapshot) {
        const isIdle = snapshot.value === 'idle'
        setIsLoading(!isIdle)
        
        // Clear error if service is in idle state
        if (isIdle) {
          setError(null)
        }
      }
      
      // Force re-render by incrementing version counter
      setVersion(prev => prev + 1)
    })
    
    subscriptionRef.current = subscription

    return () => {
      subscriptionRef.current?.unsubscribe()
      subscriptionRef.current = undefined
    }
  }, [property])

  return {
    property,
    isLoading,
    error,
  }
}
type UseItemPropertiesReturn = {
  properties: IItemProperty[]
  isLoading: boolean
  error: Error | null
}

/**
 * Hook to get all ItemProperty instances for a specific item
 * Can be called in multiple ways:
 * 1. With seedLocalId: useItemProperties({ seedLocalId })
 * 2. With seedUid: useItemProperties({ seedUid })
 * 3. With itemId: useItemProperties(itemId)
 * 
 * Uses useLiveQuery to watch for changes in the metadata table and automatically
 * updates the returned ItemProperty instances when changes occur.
 * 
 * @overload
 * @param props - Object with seedLocalId or seedUid
 * @returns Object with properties array, isLoading, and error
 * 
 * @overload
 * @param itemId - The item ID (seedLocalId or seedUid)
 * @returns Object with properties array, isLoading, and error
 */
export function useItemProperties(props: {
  seedLocalId?: string
  seedUid?: string
}): UseItemPropertiesReturn
export function useItemProperties(itemId: string): UseItemPropertiesReturn
export function useItemProperties(
  arg1: { seedLocalId?: string; seedUid?: string } | string
): UseItemPropertiesReturn {

  const [properties, setProperties] = useState<IItemProperty[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const isClientReady = useIsClientReady()
  const subscriptionsRef = useRef<Map<IItemProperty, Subscription>>(new Map())
  const loadingPropertiesRef = useRef<Set<IItemProperty>>(new Set())
  const previousTableDataRef = useRef<string | undefined>(undefined)

  // Determine which lookup mode we're in based on arguments
  const lookupMode = useMemo(() => {
    if (typeof arg1 === 'string') {
      // String argument: itemId (assumed to be seedLocalId)
      return { type: 'itemId' as const, itemId: arg1 }
    } else if (typeof arg1 === 'object') {
      // Object argument: { seedLocalId/seedUid }
      return {
        type: 'identifiers' as const,
        seedLocalId: arg1.seedLocalId,
        seedUid: arg1.seedUid,
      }
    } else {
      return null
    }
  }, [arg1])

  // Determine seedLocalId and seedUid for query
  const seedLocalId = useMemo(() => {
    if (!lookupMode) return undefined
    if (lookupMode.type === 'itemId') {
      return lookupMode.itemId
    } else {
      return lookupMode.seedLocalId
    }
  }, [lookupMode])

  const seedUid = useMemo(() => {
    if (!lookupMode || lookupMode.type === 'itemId') return undefined
    return lookupMode.seedUid
  }, [lookupMode])

  // Watch the metadata table for changes
  // Query metadata table directly and filter for latest records in JavaScript
  // This is simpler and works better with useLiveQuery than CTEs
  // Get db inside useMemo to avoid recreating query on each render
  // Drizzle query builders are new objects each time, but useMemo will only recreate
  // when dependencies change, which is what we want for reactive queries
  const propertiesQuery = useMemo(() => {
    if (!isClientReady || (!seedLocalId && !seedUid)) {
      propertiesLogger('[useItemProperties] Query: returning null (not ready or no identifiers)')
      return null
    }
    
    const db = BaseDb.getAppDb()
    if (!db) {
      propertiesLogger('[useItemProperties] Query: returning null (no db)')
      return null
    }
    
    propertiesLogger(`[useItemProperties] Query: creating query for seedLocalId=${seedLocalId}, seedUid=${seedUid}`)
    
    // Query metadata table directly - we'll filter for latest records in JavaScript
    const query = seedUid
      ? db
          .select({
            propertyName: metadata.propertyName,
            propertyValue: metadata.propertyValue,
            seedLocalId: metadata.seedLocalId,
            seedUid: metadata.seedUid,
            modelType: metadata.modelType,
            schemaUid: metadata.schemaUid,
            createdAt: metadata.createdAt,
            attestationCreatedAt: metadata.attestationCreatedAt,
          })
          .from(metadata)
          .where(
            and(
              eq(metadata.seedUid, seedUid),
              isNotNull(metadata.propertyName)
            )
          )
      : seedLocalId
          ? db
              .select({
                propertyName: metadata.propertyName,
                propertyValue: metadata.propertyValue,
                seedLocalId: metadata.seedLocalId,
                seedUid: metadata.seedUid,
                modelType: metadata.modelType,
                schemaUid: metadata.schemaUid,
                createdAt: metadata.createdAt,
                attestationCreatedAt: metadata.attestationCreatedAt,
              })
              .from(metadata)
              .where(
                and(
                  eq(metadata.seedLocalId, seedLocalId),
                  isNotNull(metadata.propertyName)
                )
              )
          : null
    
    propertiesLogger(`[useItemProperties] Query: created query object`, { queryType: seedUid ? 'seedUid' : 'seedLocalId' })
    return query
  }, [isClientReady, seedLocalId, seedUid])
  
  const rawPropertiesTableData = useLiveQuery<{
    propertyName: string | null
    propertyValue: string | null
    seedLocalId: string | null
    seedUid: string | null
    modelType: string | null
    schemaUid: string | null
    createdAt: number | null
    attestationCreatedAt: number | null
  }>(propertiesQuery)
  
  // Debug logging for rawPropertiesTableData
  useEffect(() => {
    if (rawPropertiesTableData !== undefined) {
      propertiesLogger(`[useItemProperties] rawPropertiesTableData updated:`, {
        length: rawPropertiesTableData?.length || 0,
        isUndefined: rawPropertiesTableData === undefined,
        isArray: Array.isArray(rawPropertiesTableData),
        firstRecord: rawPropertiesTableData?.[0] || null,
      })
    } else {
      propertiesLogger('[useItemProperties] rawPropertiesTableData is undefined (query not executed yet)')
    }
  }, [rawPropertiesTableData])

  // Filter for latest records (one per propertyName) in JavaScript
  const propertiesTableData = useMemo(() => {
    if (!rawPropertiesTableData || rawPropertiesTableData.length === 0) {
      return []
    }

    // Group by propertyName and keep only the latest record for each
    const latestByProperty = new Map<string, typeof rawPropertiesTableData[0]>()
    
    for (const record of rawPropertiesTableData) {
      if (!record.propertyName) continue
      
      const existing = latestByProperty.get(record.propertyName)
      if (!existing) {
        latestByProperty.set(record.propertyName, record)
      } else {
        // Compare timestamps to find the latest
        const existingTime = existing.attestationCreatedAt || existing.createdAt || 0
        const currentTime = record.attestationCreatedAt || record.createdAt || 0
        if (currentTime > existingTime) {
          latestByProperty.set(record.propertyName, record)
        }
      }
    }

    return Array.from(latestByProperty.values())
  }, [rawPropertiesTableData])

  const fetchItemProperties = useCallback(async () => {
    if (!seedLocalId && !seedUid) {
      propertiesLogger('[useItemProperties] fetchItemProperties: no identifiers, clearing properties')
      setProperties([])
      setIsLoading(false)
      setError(null)
      return
    }

    // Don't fetch if propertiesTableData is not available yet
    if (propertiesTableData === undefined) {
      propertiesLogger('[useItemProperties] fetchItemProperties: propertiesTableData is undefined, skipping')
      return
    }

      propertiesLogger(`[useItemProperties] fetchItemProperties: starting with ${propertiesTableData?.length || 0} records from table`)

    try {
      setIsLoading(true)
      setError(null)

      const db = BaseDb.getAppDb()
      if (!db) {
        propertiesLogger('[useItemProperties] fetchItemProperties: no db available')
        setProperties([])
        setIsLoading(false)
        return
      }

      // Get modelName from metadata records or from seeds table
      let modelName: string | undefined
      if (propertiesTableData && propertiesTableData.length > 0) {
        const firstProperty = propertiesTableData[0]
        if (firstProperty.modelType) {
          modelName = startCase(firstProperty.modelType)
        }
      }
      
      // If we don't have modelName from metadata, try to get it from seeds table
      if (!modelName) {
        const seedRecords = await db
          .select({ type: seeds.type })
          .from(seeds)
          .where(
            seedUid ? eq(seeds.uid, seedUid) : eq(seeds.localId, seedLocalId!)
          )
          .limit(1)
        
        if (seedRecords.length > 0 && seedRecords[0].type) {
          modelName = startCase(seedRecords[0].type)
        }
      }

      // Get all ModelProperties for this Model
      const modelProperties: string[] = []
      if (modelName) {
        try {
          const { Model } = await import('@/Model/Model')
          const model = await Model.getByNameAsync(modelName)
          if (model && model.properties) {
            for (const modelProperty of model.properties) {
              if (modelProperty.name) {
                modelProperties.push(modelProperty.name)
              }
            }
          }
        } catch (error) {
          propertiesLogger(`[useItemProperties] Error getting ModelProperties for ${modelName}:`, error)
          // Continue without ModelProperties - we'll still return properties from metadata
        }
      }

      // Create a Set of property names that have metadata records
      const propertiesWithMetadata = new Set<string>()
      if (propertiesTableData) {
        for (const dbProperty of propertiesTableData) {
          if (dbProperty.propertyName) {
            propertiesWithMetadata.add(dbProperty.propertyName)
          }
        }
      }

      const _itemProperties: IItemProperty[] = []

      // First, create ItemProperty instances for properties that have metadata records
      if (propertiesTableData && propertiesTableData.length > 0) {
        for (const dbProperty of propertiesTableData) {
          if (!dbProperty.propertyName) {
            continue
          }

          try {
            const itemProperty = await ItemProperty.find({
              propertyName: dbProperty.propertyName,
              seedLocalId: dbProperty.seedLocalId || undefined,
              seedUid: dbProperty.seedUid || undefined,
            })

            if (itemProperty) {
              _itemProperties.push(itemProperty as any as IItemProperty)
            }
          } catch (error) {
            logger(`[useItemProperties] Error creating ItemProperty for ${dbProperty.propertyName}:`, error)
            // Continue with other properties even if one fails
          }
        }
      }

      // Then, create ItemProperty instances for ModelProperties that don't have metadata records
      if (modelName && modelProperties.length > 0) {
        const resolvedSeedLocalId = propertiesTableData && propertiesTableData.length > 0 
          ? propertiesTableData[0].seedLocalId || seedLocalId
          : seedLocalId
        const resolvedSeedUid = propertiesTableData && propertiesTableData.length > 0
          ? propertiesTableData[0].seedUid || seedUid
          : seedUid

        for (const propertyName of modelProperties) {
          // Skip if we already have a metadata record for this property
          if (propertiesWithMetadata.has(propertyName)) {
            continue
          }

          try {
            // Create ItemProperty with empty value for properties without metadata records
            const itemProperty = ItemProperty.create({
              propertyName,
              modelName,
              seedLocalId: resolvedSeedLocalId || undefined,
              seedUid: resolvedSeedUid || undefined,
              propertyValue: null,
            })

            if (itemProperty) {
              _itemProperties.push(itemProperty as any as IItemProperty)
            }
          } catch (error) {
            logger(`[useItemProperties] Error creating ItemProperty for missing property ${propertyName}:`, error)
            // Continue with other properties even if one fails
          }
        }
      }

      // Also add system properties like 'createdAt' if they don't exist
      // Get createdAt from seeds table
      if (seedLocalId || seedUid) {
        const seedRecords = await db
          .select({ createdAt: seeds.createdAt })
          .from(seeds)
          .where(
            seedUid ? eq(seeds.uid, seedUid) : eq(seeds.localId, seedLocalId!)
          )
          .limit(1)
        
        if (seedRecords.length > 0 && seedRecords[0].createdAt) {
          const createdAtPropertyName = 'createdAt'
          const hasCreatedAtProperty = _itemProperties.some(p => p.propertyName === createdAtPropertyName)
          
          if (!hasCreatedAtProperty && modelName) {
            try {
              const resolvedSeedLocalId = propertiesTableData && propertiesTableData.length > 0 
                ? propertiesTableData[0].seedLocalId || seedLocalId
                : seedLocalId
              const resolvedSeedUid = propertiesTableData && propertiesTableData.length > 0
                ? propertiesTableData[0].seedUid || seedUid
                : seedUid

              const createdAtProperty = ItemProperty.create({
                propertyName: createdAtPropertyName,
                modelName,
                seedLocalId: resolvedSeedLocalId || undefined,
                seedUid: resolvedSeedUid || undefined,
                propertyValue: seedRecords[0].createdAt.toString(),
              })

              if (createdAtProperty) {
                _itemProperties.push(createdAtProperty as any as IItemProperty)
              }
            } catch (error) {
              logger(`[useItemProperties] Error creating createdAt ItemProperty:`, error)
            }
          }
        }
      }

      // Filter out properties that are ready (idle state) vs still loading
      const readyProperties: IItemProperty[] = []
      const loadingPropertiesList: IItemProperty[] = []

      // Clear previous loading set
      loadingPropertiesRef.current.clear()

      for (const property of _itemProperties) {
        const snapshot = property.getService().getSnapshot()
        // Use type guard to check if snapshot has 'value' property
        const isIdle = snapshot && typeof snapshot === 'object' && 'value' in snapshot && snapshot.value === 'idle'

        if (isIdle) {
          // Property is ready
          readyProperties.push(property)
        } else {
          // Property is still loading - subscribe to state changes
          loadingPropertiesList.push(property)
          loadingPropertiesRef.current.add(property)

          // Clean up any existing subscription for this property
          const existingSub = subscriptionsRef.current.get(property)
          if (existingSub) {
            existingSub.unsubscribe()
          }

          // Subscribe to state changes
          const subscription = property.getService().subscribe((snapshot: any) => {
            // Use type guard to check if snapshot has 'value' property
            if (snapshot && typeof snapshot === 'object' && 'value' in snapshot) {
              const isIdle = snapshot.value === 'idle'

              if (isIdle) {
                // Property is now ready - update state
                setProperties(prev => {
                  // Check if property is already in the list (by propertyName and seedLocalId/seedUid)
                  const exists = prev.some(p => 
                    p.propertyName === property.propertyName &&
                    (p.seedLocalId === property.seedLocalId || p.seedUid === property.seedUid)
                  )
                  if (exists) {
                    return prev
                  }
                  // Add the newly ready property
                  return [...prev, property]
                })

                // Remove from loading set and clean up subscription
                loadingPropertiesRef.current.delete(property)
                subscription.unsubscribe()
                subscriptionsRef.current.delete(property)

                // Update loading state based on remaining loading properties
                setIsLoading(loadingPropertiesRef.current.size > 0)
              } else if (snapshot.value === 'error') {
                // Property failed to load - clean up subscription
                loadingPropertiesRef.current.delete(property)
                subscription.unsubscribe()
                subscriptionsRef.current.delete(property)

                // Update loading state based on remaining loading properties
                setIsLoading(loadingPropertiesRef.current.size > 0)
              }
            }
          })

          subscriptionsRef.current.set(property, subscription)
        }
      }

      // Set initial ready properties
      setProperties(readyProperties)
      setError(null)
      setIsLoading(loadingPropertiesList.length > 0) // Still loading if any properties are loading
    } catch (error) {
      setError(error as Error)
      setIsLoading(false)
    }
  }, [seedLocalId, seedUid, propertiesTableData])

  // Reset previous table data ref when identifiers change
  useEffect(() => {
    previousTableDataRef.current = undefined
  }, [seedLocalId, seedUid])

  // Fetch item properties when dbModelId becomes available
  useEffect(() => {
    if (!isClientReady) {
      return
    }
    
    if (!seedLocalId && !seedUid) {
      setProperties([])
      setIsLoading(false)
      setError(null)
      previousTableDataRef.current = undefined
      return
    }
    
    // Wait for propertiesTableData to be available before initial fetch
    // (it may be undefined initially while the query is starting)
    if (propertiesTableData === undefined) {
      return
    }
    // Initial fetch when client is ready and propertiesTableData is available
    fetchItemProperties()
  }, [isClientReady, seedLocalId, seedUid, fetchItemProperties, propertiesTableData])

  // Refetch item properties when table data actually changes (not just reference)
  useEffect(() => {
    if (!isClientReady || (!seedLocalId && !seedUid)) {
      return
    }

    // If propertiesTableData is undefined, the query hasn't started yet - wait for it
    if (propertiesTableData === undefined) {
      return
    }

    // Create a stable string representation of the table data for comparison
    const tableDataString = JSON.stringify(
      propertiesTableData.map(p => ({
        propertyName: p.propertyName,
        seedLocalId: p.seedLocalId,
        seedUid: p.seedUid,
      })).sort((a, b) => (a.propertyName || '').localeCompare(b.propertyName || ''))
    )

    // Skip if table data hasn't actually changed
    if (previousTableDataRef.current === tableDataString) {
      return
    }

    previousTableDataRef.current = tableDataString

    // Extract identifying information from current properties in state
    const currentPropertiesSet = new Set<string>()
    for (const prop of properties) {
      const key = `${prop.propertyName}:${prop.seedLocalId || prop.seedUid}`
      currentPropertiesSet.add(key)
    }

    // Extract identifying information from propertiesTableData
    const tableDataPropertiesSet = new Set<string>()
    for (const dbProperty of propertiesTableData) {
      if (dbProperty.propertyName) {
        const key = `${dbProperty.propertyName}:${dbProperty.seedLocalId || dbProperty.seedUid}`
        tableDataPropertiesSet.add(key)
      }
    }

    // Compare sets to detect changes
    // If tableDataPropertiesSet is empty but we have properties, or vice versa, that's a change
    // If both are empty, skip (no data yet) - UNLESS this is the first time we're seeing empty data
    // If both have data and match, skip
    const setsAreEqual =
      currentPropertiesSet.size === tableDataPropertiesSet.size &&
      currentPropertiesSet.size > 0 &&
      [...currentPropertiesSet].every(id => tableDataPropertiesSet.has(id))

    if (setsAreEqual) {
      // Properties in state match table data, skip refetch
      return
    }

    // Always refetch if table data has properties (even if we don't have any yet)
    // This handles the case where propertiesTableData changes from empty to having data
    if (tableDataPropertiesSet.size > 0) {
      // Properties have changed or data has arrived, fetch updated properties
      fetchItemProperties()
      return
    }

    // If table data is empty but we have properties, that's also a change (properties were removed)
    if (currentPropertiesSet.size > 0 && tableDataPropertiesSet.size === 0) {
      fetchItemProperties()
      return
    }

    // If both are empty, we've already tried to fetch (in the first useEffect)
    // and got empty results, so skip refetching until data arrives
    // (the change detection above will handle when data arrives)
  }, [isClientReady, propertiesTableData, properties, fetchItemProperties, seedLocalId, seedUid])

  // Cleanup subscriptions for properties that are no longer in the list
  useEffect(() => {
    const currentPropertyKeys = new Set<string>()
    for (const prop of properties) {
      const key = `${prop.propertyName}:${prop.seedLocalId || prop.seedUid}`
      currentPropertyKeys.add(key)
    }

    // Clean up subscriptions for properties that are no longer in the list
    for (const [property, subscription] of subscriptionsRef.current.entries()) {
      const key = `${property.propertyName}:${property.seedLocalId || property.seedUid}`
      if (!currentPropertyKeys.has(key)) {
        // Property is no longer in the list, clean up subscription
        subscription.unsubscribe()
        subscriptionsRef.current.delete(property)
        loadingPropertiesRef.current.delete(property)
      }
    }

    // Update loading state based on remaining loading properties
    if (loadingPropertiesRef.current.size === 0 && isLoading) {
      setIsLoading(false)
    }
  }, [properties, isLoading])

  // Cleanup all subscriptions on unmount
  useEffect(() => {
    return () => {
      subscriptionsRef.current.forEach(sub => sub.unsubscribe())
      subscriptionsRef.current.clear()
      loadingPropertiesRef.current.clear()
    }
  }, [])

  return {
    properties,
    isLoading,
    error,
  }
}

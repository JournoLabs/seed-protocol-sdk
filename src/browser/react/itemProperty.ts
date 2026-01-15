import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Subscription, SnapshotFrom } from 'xstate'
import debug from 'debug'
import { ItemProperty } from '@/ItemProperty/ItemProperty'
import { useIsClientReady } from './client'
import { IItemProperty } from '@/interfaces'
import { useLiveQuery } from './liveQuery'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata } from '@/seedSchema/MetadataSchema'
import { and, eq, isNotNull } from 'drizzle-orm'
import { getMetadataLatest } from '@/db/read/subqueries/metadataLatest'
import { propertyMachine } from '@/ItemProperty/service/propertyMachine'

const logger = debug('seedSdk:react:property')

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
  // Use SQL tag function for liveQuery (similar to ItemProperty._setupLiveQuerySubscription)
  // This works better with CTEs than Drizzle query builders
  const propertiesQuery = useMemo(() => {
    if (!isClientReady || (!seedLocalId && !seedUid)) return null
    
    const resolvedSeedUid = seedUid || null
    const resolvedSeedLocalId = seedLocalId || null
    
    // Use SQL tag function for better compatibility with liveQuery
    return (sql: any) => {
      if (resolvedSeedUid) {
        return sql`
          WITH metadataLatest AS (
            SELECT *,
              ROW_NUMBER() OVER (
                PARTITION BY property_name 
                ORDER BY COALESCE(created_at, attestation_created_at) DESC
              ) as rowNum
            FROM metadata
            WHERE seed_uid = ${resolvedSeedUid}
          )
          SELECT property_name as propertyName, property_value as propertyValue,
                 seed_local_id as seedLocalId, seed_uid as seedUid,
                 model_type as modelType, schema_uid as schemaUid
          FROM metadataLatest
          WHERE rowNum = 1 AND property_name IS NOT NULL
        `
      } else if (resolvedSeedLocalId) {
        return sql`
          WITH metadataLatest AS (
            SELECT *,
              ROW_NUMBER() OVER (
                PARTITION BY property_name 
                ORDER BY COALESCE(created_at, attestation_created_at) DESC
              ) as rowNum
            FROM metadata
            WHERE seed_local_id = ${resolvedSeedLocalId}
          )
          SELECT property_name as propertyName, property_value as propertyValue,
                 seed_local_id as seedLocalId, seed_uid as seedUid,
                 model_type as modelType, schema_uid as schemaUid
          FROM metadataLatest
          WHERE rowNum = 1 AND property_name IS NOT NULL
        `
      }
      return null
    }
  }, [isClientReady, seedLocalId, seedUid])
  
  const propertiesTableData = useLiveQuery<{
    propertyName: string | null
    propertyValue: string | null
    seedLocalId: string | null
    seedUid: string | null
    modelType: string | null
    schemaUid: string | null
  }>(propertiesQuery)

  const fetchItemProperties = useCallback(async () => {
    if (!seedLocalId && !seedUid) {
      setProperties([])
      setIsLoading(false)
      setError(null)
      return
    }

    // Don't fetch if propertiesTableData is not available yet
    if (propertiesTableData === undefined) {
      return
    }

    try {
      setIsLoading(true)
      setError(null)

      // Use propertiesTableData (database state) as the source of truth
      // If empty, set properties to empty but keep loading state based on whether we expect data
      // (This allows liveQuery to update when data arrives)
      if (!propertiesTableData || propertiesTableData.length === 0) {
        // Only set to empty if we've already tried loading (to avoid flickering)
        // Otherwise, keep current state and let liveQuery update when data arrives
        if (properties.length === 0) {
          setProperties([])
          setError(null)
          setIsLoading(false)
        }
        return
      }

      const _itemProperties: IItemProperty[] = []

      // Iterate over propertiesTableData and create ItemProperty instances
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
            _itemProperties.push(itemProperty)
          }
        } catch (error) {
          logger(`[useItemProperties] Error creating ItemProperty for ${dbProperty.propertyName}:`, error)
          // Continue with other properties even if one fails
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
    }
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

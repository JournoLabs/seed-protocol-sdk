import { Observable, Subscription } from 'rxjs'
import debug from 'debug'

/**
 * Configuration for entity liveQuery setup
 */
export interface LiveQueryConfig<T> {
  /**
   * Get entity identifier for query (e.g., schemaId, modelId, seedLocalId)
   * Returns the ID needed to build the query
   */
  getEntityId: (instance: T) => Promise<number | string | undefined>
  /**
   * Build the liveQuery query (returns Observable)
   * Called with the entity ID from getEntityId
   * Can be async to allow dynamic imports
   */
  buildQuery: (entityId: number | string) => Observable<any[]> | Promise<Observable<any[]>>
  /**
   * Transform query results to entity IDs
   * Extracts the relevant IDs from the query result rows
   */
  extractEntityIds: (rows: any[]) => string[]
  /**
   * Update entity context with new IDs
   * Called when query results change
   */
  updateContext: (instance: T, ids: string[]) => void
  /**
   * Optional: Create child entity instances before updating context
   * This ensures instances are in cache when context is updated
   */
  createChildInstances?: (ids: string[]) => Promise<void>
  /**
   * Instance state WeakMap (for storing subscription)
   */
  instanceState: WeakMap<T, { liveQuerySubscription: Subscription | null }>
  /**
   * Logger name for debugging
   */
  loggerName: string
  /**
   * Optional: Query initial data immediately (for Node.js compatibility)
   * If provided, this will be called to get initial data before setting up subscription
   */
  queryInitialData?: (entityId: number | string) => Promise<any[]>
  /**
   * Optional: Check if entity is ready before setting up subscription
   * Returns true if ready, false otherwise
   */
  isReady?: (instance: T) => boolean
  /**
   * Optional: Wait for entity to be ready
   * Called if isReady returns false
   */
  waitForReady?: (instance: T) => Promise<void>
}

/**
 * Set up liveQuery subscription for an entity
 * This enables cross-instance synchronization (e.g., changes in other tabs/windows)
 * 
 * @param instance - Entity instance
 * @param config - LiveQuery configuration
 */
export function setupEntityLiveQuery<T extends { getService(): any }>(
  instance: T,
  config: LiveQueryConfig<T>
): void {
  const isBrowser = typeof window !== 'undefined'
  const logger = debug(config.loggerName)
  
  // Use a closure variable to track setup state per instance
  const setupState = { subscriptionSetUp: false }

  const setupLiveQuery = async (entityId: number | string) => {
    if (setupState.subscriptionSetUp) {
      return
    }

    setupState.subscriptionSetUp = true
    logger(`Setting up liveQuery for entity ID: ${entityId}`)
    
    try {
      // Query initial data if provided (for Node.js compatibility)
      if (config.queryInitialData) {
        const initialRows = await config.queryInitialData(entityId)
        const initialIds = config.extractEntityIds(initialRows)
        
        if (initialIds.length > 0) {
          logger(`Initial query returned ${initialIds.length} entities`)
          
          // Create child instances if provided
          if (config.createChildInstances) {
            await config.createChildInstances(initialIds)
          }
          
          // Update context with initial IDs
          config.updateContext(instance, initialIds)
        }
      }

      // Only set up liveQuery subscription in browser environment
      if (isBrowser) {
        // buildQuery can be async to allow dynamic imports
        const queryResult = config.buildQuery(entityId)
        const query$ = queryResult instanceof Promise ? await queryResult : queryResult
        
        const instanceState = config.instanceState.get(instance)
        if (!instanceState) {
          logger('Instance state not found')
          return
        }

        // Subscribe to liveQuery updates
        const subscription = query$.subscribe({
          next: async (rows) => {
            // Check if instance state still exists (hasn't been cleaned up)
            const currentInstanceState = config.instanceState.get(instance)
            if (!currentInstanceState) {
              logger('Instance state was cleaned up, skipping update')
              return
            }
            
            logger(`Query returned ${rows.length} rows`)
            
            const ids = config.extractEntityIds(rows)
            
            // Create child instances if provided (before updating context)
            if (config.createChildInstances && ids.length > 0) {
              await config.createChildInstances(ids)
            }
            
            // Update context with new IDs
            config.updateContext(instance, ids)
          },
          error: (error) => {
            logger(`LiveQuery error: ${error}`)
          },
        })

        instanceState.liveQuerySubscription = subscription
        logger(`LiveQuery subscription set up for entity ID: ${entityId}`)
      } else {
        logger('Skipping liveQuery subscription in Node.js environment')
      }
    } catch (error) {
      logger(`Error setting up subscription: ${error}`)
      setupState.subscriptionSetUp = false // Reset on error so we can retry
    }
  }

  // Set up liveQuery subscription as soon as we have entity ID
  const setupSubscription = instance.getService().subscribe(async (snapshot: any) => {
    // Check if entity is ready
    if (config.isReady && !config.isReady(instance)) {
      if (config.waitForReady) {
        await config.waitForReady(instance)
      } else {
        return // Not ready yet, will retry on next snapshot
      }
    }
    
    // Get entity ID
    const entityId = await config.getEntityId(instance)
    
    if (!entityId) {
      return // Need entity ID to proceed
    }

    // Once we have entity ID, set up the liveQuery subscription (only once)
    if (!setupState.subscriptionSetUp) {
      await setupLiveQuery(entityId)
      if (setupState.subscriptionSetUp) {
        setupSubscription.unsubscribe()
      }
    }
  })
  
  // Also check current state immediately in case entity ID is already available
  const currentSnapshot = instance.getService().getSnapshot()
  if (config.isReady && !config.isReady(instance)) {
    // Not ready yet, will be handled by subscription
    return
  }
  
  config.getEntityId(instance).then((entityId) => {
    if (entityId && !setupState.subscriptionSetUp) {
      setupLiveQuery(entityId).catch((error) => {
        logger(`Error in immediate setup: ${error}`)
      })
    }
  }).catch((error) => {
        logger(`Error getting entity ID: ${error}`)
      })
}

import { Observable } from 'rxjs'
import debug from 'debug'
import { isActorStopped } from './entityCommon'
import { isEntityTornDown, onEntityTeardown } from './entityLifecycle'

/**
 * Configuration for entity liveQuery setup
 */
export interface LiveQueryConfig<T extends object> {
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
   * Logger name for debugging
   */
  loggerName: string
  /**
   * Optional: Query initial data immediately (for Node.js compatibility)
   * If provided, this will be called to get initial data before setting up subscription
   */
  queryInitialData?: (entityId: number | string) => Promise<any[]>
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
          
          // Create child instances if provided (not for a stopped entity: an unloaded or evicted
          // parent must not re-cache its children)
          if (isActorStopped(instance.getService())) return
          if (config.createChildInstances) {
            await config.createChildInstances(initialIds)
          }
          
          // Update context with initial IDs (the queries above can outlive the instance)
          if (isActorStopped(instance.getService())) return
          config.updateContext(instance, initialIds)
        }
      }

      // Only set up liveQuery subscription in browser environment
      if (isBrowser) {
        // buildQuery can be async to allow dynamic imports
        const queryResult = config.buildQuery(entityId)
        const query$ = queryResult instanceof Promise ? await queryResult : queryResult
        
        // Unloaded or destroyed while setup awaited: subscribing now would leak the query.
        if (isActorStopped(instance.getService()) || isEntityTornDown(instance)) return

        // Subscribe to liveQuery updates
        const subscription = query$.subscribe({
          next: async (rows) => {
            // Check if instance state still exists (hasn't been cleaned up)
            if (isEntityTornDown(instance)) {
              logger('Instance state was cleaned up, skipping update')
              return
            }
            
            logger(`Query returned ${rows.length} rows`)
            
            const ids = config.extractEntityIds(rows)
            
            // Create child instances if provided (before updating context; not for a stopped entity)
            if (isActorStopped(instance.getService())) return
            if (config.createChildInstances && ids.length > 0) {
              // Nothing awaits this handler, so a child that fails to load (its row deleted while it
              // loads, say) would be an unhandled rejection. Skip this result; a later one tries again.
              try {
                await config.createChildInstances(ids)
              } catch (error) {
                logger(`createChildInstances failed: ${error}`)
                return
              }
            }
            
            // Update context with new IDs
            if (isActorStopped(instance.getService())) return
            config.updateContext(instance, ids)
          },
          error: (error) => {
            logger(`LiveQuery error: ${error}`)
          },
        })

        // Ends when the entity is torn down
        onEntityTeardown(instance, () => subscription.unsubscribe())
        logger(`LiveQuery subscription set up for entity ID: ${entityId}`)
      } else {
        logger('Skipping liveQuery subscription in Node.js environment')
      }
    } catch (error) {
      logger(`Error setting up subscription: ${error}`)
      setupState.subscriptionSetUp = false // Reset on error so we can retry
    }
  }

  // Retried on each snapshot until the entity has its row id: its load or its row write sends it
  const trySetup = async () => {
    if (setupState.subscriptionSetUp || isActorStopped(instance.getService())) return

    let entityId: number | string | undefined
    try {
      entityId = await config.getEntityId(instance)
    } catch (error) {
      logger(`Error getting entity ID: ${error}`)
    }

    if (!entityId) return

    // Once we have entity ID, set up the liveQuery subscription (only once)
    if (!setupState.subscriptionSetUp) {
      await setupLiveQuery(entityId)
    }
    if (setupState.subscriptionSetUp) setupSubscription.unsubscribe()
  }

  // Set up liveQuery subscription as soon as we have entity ID
  const setupSubscription = instance.getService().subscribe(() => {
    void trySetup()
  })

  // Also check current state immediately in case entity ID is already available
  void trySetup()
}

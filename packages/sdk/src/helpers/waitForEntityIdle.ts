import { waitFor } from 'xstate'

/** Any entity that exposes an xstate actor via getService(). Loosely typed so Schema/Model/Item/ModelProperty (different machine contexts) are all accepted. */
interface EntityWithService {
  getService(): any
}

/**
 * Wait for an entity's state machine to reach 'idle' state
 * @param entity - Entity instance with getService() method
 * @param options - Configuration options
 * @returns Promise that resolves when entity reaches idle, or rejects on error/timeout
 */
export async function waitForEntityIdle(
  entity: EntityWithService,
  options: {
    timeout?: number
    throwOnError?: boolean
  } = {}
): Promise<void> {
  const { timeout = 5000, throwOnError = true } = options
  const service = entity.getService()
  const currentSnapshot = service.getSnapshot()

  // Check current state first - if already idle, return immediately
  if ('value' in currentSnapshot && currentSnapshot.value === 'idle') {
    return
  }

  if ('value' in currentSnapshot && currentSnapshot.value === 'error') {
    if (throwOnError) {
      throw new Error('Entity failed to load')
    }
    return
  }

  try {
    await waitFor(
      service,
      (snapshot) => {
        if ('value' in snapshot && snapshot.value === 'error') {
          if (throwOnError) {
            throw new Error('Entity failed to load')
          }
          return true // Accept error state if not throwing
        }
        return 'value' in snapshot && snapshot.value === 'idle'
      },
      { timeout }
    )
  } catch (error: any) {
    if (error.message === 'Entity failed to load') {
      throw error
    }
    throw new Error(`Entity loading timeout after ${timeout}ms`)
  }
}

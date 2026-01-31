import { waitFor } from 'xstate'
import type { ActorRefFrom, SnapshotFrom } from 'xstate'

interface EntityWithService {
  getService(): ActorRefFrom<any>
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
  
  // Check current state first - if already idle, return immediately
  const currentSnapshot = service.getSnapshot()
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

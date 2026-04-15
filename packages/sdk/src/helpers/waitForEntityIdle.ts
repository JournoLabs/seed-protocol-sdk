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

  const isSnapshotIdle = (snapshot: { value?: unknown; context?: { isSaving?: boolean } }) => {
    if (!('value' in snapshot) || snapshot.value !== 'idle') {
      return false
    }
    // ItemProperty: same condition as ItemProperty.save() — nested "saving" uses object state values
    if (snapshot.context?.isSaving) {
      return false
    }
    return true
  }

  // Check current state first - if already idle, return immediately
  if (isSnapshotIdle(currentSnapshot as any)) {
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
        return isSnapshotIdle(snapshot as any)
      },
      { timeout }
    )
  } catch (error: any) {
    if (error.message === 'Entity failed to load') {
      throw error
    }
    const msg = typeof error?.message === 'string' ? error.message : ''
    const isWaitForTimeout =
      msg.includes('Timeout') || msg.toLowerCase().includes('timed out')
    if (!throwOnError && isWaitForTimeout) {
      return
    }
    throw new Error(`Entity loading timeout after ${timeout}ms`)
  }
}

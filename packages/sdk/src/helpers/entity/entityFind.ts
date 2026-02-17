import { waitForEntityIdle } from '../waitForEntityIdle'

/**
 * Configuration for entity find operations
 */
export interface FindConfig<T> {
  /**
   * Cache lookup by ID
   */
  getById: (id: string) => T | undefined
  /**
   * Database lookup and instance creation by ID
   */
  createById: (id: string) => Promise<T | undefined>
  /**
   * Optional: Additional lookup methods (e.g., getByName)
   */
  getByName?: (name: string, ...args: any[]) => T | undefined
  /**
   * Optional: Create instance by name
   */
  createByName?: (name: string, ...args: any[]) => Promise<T | undefined>
}

/**
 * Find options
 */
export interface FindOptions {
  /**
   * Wait for entity to reach idle state
   * @default true
   */
  waitForReady?: boolean
  /**
   * Timeout for waiting for ready state (ms)
   * @default 5000
   */
  readyTimeout?: number
}

/**
 * Generic find implementation for entities
 * 
 * @param config - Find configuration with lookup methods
 * @param params - Find parameters (id, name, or other entity-specific params)
 * @param options - Find options (waitForReady, readyTimeout)
 * @returns Entity instance if found, undefined otherwise
 */
export async function findEntity<T extends { getService(): any }>(
  config: FindConfig<T>,
  params: {
    id?: string
    name?: string
    [key: string]: any
  },
  options: FindOptions = {}
): Promise<T | undefined> {
  const { waitForReady = true, readyTimeout = 5000 } = options
  let instance: T | undefined

  // Try ID lookup first (most specific)
  if (params.id) {
    instance = config.getById(params.id)
    if (!instance) {
      instance = await config.createById(params.id)
    }
  }
  // Fall back to name lookup if available
  else if (params.name && config.getByName && config.createByName) {
    const nameArgs: any[] = []
    // Extract additional args from params (everything except id and name)
    for (const [key, value] of Object.entries(params)) {
      if (key !== 'id' && key !== 'name') {
        nameArgs.push(value)
      }
    }
    instance = config.getByName(params.name, ...nameArgs)
    if (!instance && config.createByName) {
      instance = await config.createByName(params.name, ...nameArgs)
    }
  } else {
    return undefined
  }

  if (!instance) {
    return undefined
  }

  if (waitForReady) {
    await waitForEntityIdle(instance, { timeout: readyTimeout })
  }

  return instance
}

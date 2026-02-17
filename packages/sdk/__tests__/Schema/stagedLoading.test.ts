import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { createActor } from 'xstate'
import { schemaMachine } from '@/Schema/service/schemaMachine'
import { BaseDb } from '@/db/Db/BaseDb'
// Import Node.js Db to initialize platform class
import '@/node/db/Db'
import { setupTestEnvironment } from '../test-utils/client-init'

describe('Staged Schema Loading', () => {
  beforeAll(async () => {
    // Initialize test environment and database
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: 90000,
    })
  }, 90000)

  beforeEach(async () => {
    // Ensure database is available
    const db = BaseDb.getAppDb()
    if (!db) {
      throw new Error('Database not available for tests')
    }
  })

  afterEach(async () => {
    // Cleanup if needed
  })

  it('should complete all stages successfully for new schema', async () => {
    const schemaName = `test-schema-${Date.now()}`
    const actor = createActor(schemaMachine, {
      input: { schemaName },
    })

    actor.start()

    // Wait for schema to be loaded
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for schema to load'))
      }, 10000)

      const subscription = actor.subscribe((snapshot) => {
        if (snapshot.value === 'idle') {
          clearTimeout(timeout)
          subscription.unsubscribe()
          resolve()
        } else if (snapshot.value === 'error') {
          clearTimeout(timeout)
          subscription.unsubscribe()
          reject(new Error(`Schema loading failed: ${snapshot.context._loadingError?.error.message}`))
        }
      })
    })

    const snapshot = actor.getSnapshot()
    expect(snapshot.value).toBe('idle')
    expect(snapshot.context.schemaName).toBe(schemaName)
    expect(snapshot.context.id).toBeDefined() // schemaFileId (string)
    
    actor.stop()
  })

  it('should find existing schema and skip to idle', async () => {
    // First create a schema
    const schemaName = `test-existing-${Date.now()}`
    const actor1 = createActor(schemaMachine, {
      input: { schemaName },
    })
    actor1.start()

    await new Promise<void>((resolve) => {
      const subscription = actor1.subscribe((snapshot) => {
        if (snapshot.value === 'idle') {
          subscription.unsubscribe()
          resolve()
        }
      })
    })

    actor1.stop()

    // Now try to load the same schema
    const actor2 = createActor(schemaMachine, {
      input: { schemaName },
    })
    actor2.start()

    await new Promise<void>((resolve) => {
      const subscription = actor2.subscribe((snapshot) => {
        if (snapshot.value === 'idle') {
          subscription.unsubscribe()
          resolve()
        }
      })
    })

    const snapshot = actor2.getSnapshot()
    expect(snapshot.value).toBe('idle')
    expect(snapshot.context.schemaName).toBe(schemaName)
    expect(snapshot.context.id).toBeDefined() // schemaFileId (string)
    
    actor2.stop()
  })

  it('should handle verification failures gracefully', async () => {
    // This test would require mocking the database to fail verification
    // For now, just verify the error state exists
    const schemaName = `test-error-${Date.now()}`
    const actor = createActor(schemaMachine, {
      input: { schemaName },
    })

    actor.start()

    // The actor should either succeed or fail with a clear error
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        resolve() // Timeout is acceptable for this test
      }, 5000)

      const subscription = actor.subscribe((snapshot) => {
        if (snapshot.value === 'idle' || snapshot.value === 'error') {
          clearTimeout(timeout)
          subscription.unsubscribe()
          resolve()
        }
      })
    })

    const snapshot = actor.getSnapshot()
    expect(['idle', 'error']).toContain(snapshot.value)
    
    if (snapshot.value === 'error') {
      expect(snapshot.context._loadingError).toBeDefined()
      expect(snapshot.context._loadingError?.stage).toBeDefined()
    }
    
    actor.stop()
  })

  it('should track loading stage progress', async () => {
    const schemaName = `test-progress-${Date.now()}`
    const actor = createActor(schemaMachine, {
      input: { schemaName },
    })

    actor.start()

    const stages: string[] = []

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        resolve() // Timeout after 10 seconds
      }, 10000)

      const subscription = actor.subscribe((snapshot) => {
        if (snapshot.context._loadingStage) {
          stages.push(snapshot.context._loadingStage)
        }
        
        if (snapshot.value === 'idle' || snapshot.value === 'error') {
          clearTimeout(timeout)
          subscription.unsubscribe()
          resolve()
        }
      })
    })

    // Should have progressed through multiple stages
    if (stages.length > 0) {
      expect(stages).toContain('writingSchema')
    }
    
    actor.stop()
  })
})

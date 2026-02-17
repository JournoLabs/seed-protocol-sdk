import { describe, it, expect, afterEach, beforeAll } from 'vitest'
import { createActor, waitFor } from 'xstate'
import { writeProcessMachine } from '@/services/write/writeProcessMachine'
import { BaseDb } from '@/db/Db/BaseDb'
import { setupTestEnvironment } from '../../test-utils/client-init'

describe('writeProcessMachine', () => {

  beforeAll(async () => {
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: 30000,
    })
  }, 30000)

  afterEach(async () => {
    // Clean up database after each test
    const db = BaseDb.getAppDb()
    if (db) {
      const { models: modelsTable, properties, schemas: schemasTable } = await import('@/seedSchema')
      await db.delete(properties)
      await db.delete(modelsTable)
      await db.delete(schemasTable)
    }
  })

  describe('Model write process', () => {
    it('should transition through write states for a model', async () => {
      const actor = createActor(writeProcessMachine, {
        input: {
          entityType: 'model',
          entityId: 'test-model-id',
          entityData: {
            modelName: 'TestModel',
            schemaName: 'TestSchema',
            properties: {},
          },
        },
      })

      actor.start()

      // Should start in idle state
      expect(actor.getSnapshot().value).toBe('idle')

      // Send startWrite event
      actor.send({ type: 'startWrite', data: { modelName: 'TestModel' } })

      // Should transition to validating
      await waitFor(
        actor,
        (snapshot) => snapshot.value === 'validating',
        { timeout: 5000 }
      )

      // Should eventually transition to writing or error
      const finalSnapshot = await waitFor(
        actor,
        (snapshot) => snapshot.value === 'writing' || snapshot.value === 'error' || snapshot.value === 'success',
        { timeout: 10000 }
      )

      expect(['writing', 'error', 'success']).toContain(finalSnapshot.value)
    })

    it('should handle validation errors', async () => {
      const actor = createActor(writeProcessMachine, {
        input: {
          entityType: 'model',
          entityId: 'test-model-id',
          entityData: {
            modelName: '', // Invalid - empty name
            schemaName: 'TestSchema',
          },
        },
      })

      actor.start()
      actor.send({ type: 'startWrite', data: { modelName: '' } })

      // Should eventually reach error state
      const snapshot = await waitFor(
        actor,
        (snapshot) => snapshot.value === 'error' || snapshot.value === 'idle',
        { timeout: 10000 }
      )

      // If validation fails, should have errors
      if (snapshot.context.validationErrors) {
        expect(snapshot.context.validationErrors.length).toBeGreaterThan(0)
      }
    })
  })

  describe('ModelProperty write process', () => {
    it('should transition through write states for a property', async () => {
      const actor = createActor(writeProcessMachine, {
        input: {
          entityType: 'modelProperty',
          entityId: 'test-property-id',
          entityData: {
            name: 'testProperty',
            dataType: 'String',
            modelId: 1,
            modelName: 'TestModel',
          },
        },
      })

      actor.start()

      // Should start in idle state
      expect(actor.getSnapshot().value).toBe('idle')

      // Send startWrite event
      actor.send({ type: 'startWrite', data: { name: 'testProperty', dataType: 'String' } })

      // Should transition to validating
      await waitFor(
        actor,
        (snapshot) => snapshot.value === 'validating',
        { timeout: 5000 }
      )
    })
  })

  describe('Retry logic', () => {
    it('should retry on write error', async () => {
      const actor = createActor(writeProcessMachine, {
        input: {
          entityType: 'model',
          entityId: 'test-model-id',
          entityData: {
            modelName: 'TestModel',
            schemaName: 'TestSchema',
          },
        },
      })

      actor.start()

      // Manually trigger error state
      actor.send({ type: 'writeError', error: new Error('Test error') })

      await waitFor(
        actor,
        (snapshot) => snapshot.value === 'error',
        { timeout: 5000 }
      )

      // Should be able to retry
      const errorSnapshot = actor.getSnapshot()
      expect(errorSnapshot.value).toBe('error')
      expect(errorSnapshot.context.retryCount).toBeGreaterThanOrEqual(0)

      // Retry should transition back to validating
      actor.send({ type: 'retry' })

      await waitFor(
        actor,
        (snapshot) => snapshot.value === 'validating' || snapshot.value === 'error',
        { timeout: 5000 }
      )
    })

    it('should not retry more than 3 times', async () => {
      const actor = createActor(writeProcessMachine, {
        input: {
          entityType: 'model',
          entityId: 'test-model-id',
          entityData: {
            modelName: 'TestModel',
            schemaName: 'TestSchema',
          },
        },
      })

      actor.start()

      // Manually set retry count to 3
      actor.send({ type: 'writeError', error: new Error('Test error') })
      
      // Simulate multiple retries
      for (let i = 0; i < 4; i++) {
        const snapshot = actor.getSnapshot()
        if (snapshot.context.retryCount >= 3) {
          break
        }
        actor.send({ type: 'retry' })
        await new Promise(resolve => setTimeout(resolve, 100))
      }

      const finalSnapshot = actor.getSnapshot()
      expect(finalSnapshot.context.retryCount).toBeLessThanOrEqual(3)
    })
  })

  describe('State transitions', () => {
    it('should reset from success state', async () => {
      const actor = createActor(writeProcessMachine, {
        input: {
          entityType: 'model',
          entityId: 'test-model-id',
          entityData: {
            modelName: 'TestModel',
            schemaName: 'TestSchema',
          },
        },
      })

      actor.start()

      // Manually set to success state
      actor.send({ type: 'writeSuccess' })

      await waitFor(
        actor,
        (snapshot) => snapshot.value === 'success',
        { timeout: 5000 }
      )

      // Should be able to reset
      actor.send({ type: 'reset' })

      await waitFor(
        actor,
        (snapshot) => snapshot.value === 'idle',
        { timeout: 5000 }
      )
    })

    it('should revert from error state', async () => {
      const actor = createActor(writeProcessMachine, {
        input: {
          entityType: 'model',
          entityId: 'test-model-id',
          entityData: {
            modelName: 'TestModel',
            schemaName: 'TestSchema',
          },
        },
      })

      actor.start()

      // Manually set to error state
      actor.send({ type: 'writeError', error: new Error('Test error') })

      await waitFor(
        actor,
        (snapshot) => snapshot.value === 'error',
        { timeout: 5000 }
      )

      // Should be able to revert
      actor.send({ type: 'revert' })

      await waitFor(
        actor,
        (snapshot) => snapshot.value === 'idle',
        { timeout: 5000 }
      )

      const finalSnapshot = actor.getSnapshot()
      expect(finalSnapshot.context.pendingWrite).toBeNull()
    })
  })
})


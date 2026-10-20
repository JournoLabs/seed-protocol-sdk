import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest'
import { createActor, fromCallback, fromPromise, waitFor, type AnyActorRef } from 'xstate'
import { writeProcessMachine } from '@/services/write/writeProcessMachine'
import { setupTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../../test-utils/client-init'
import { cleanupTestSchemaData } from '../../test-utils/cleanupTestDb'
import { WAIT_TIMEOUT_MS } from '../../test-utils/timeouts'

describe('writeProcessMachine', () => {

  beforeAll(async () => {
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: SETUP_HOOK_TIMEOUT_MS,
    })
  }, SETUP_HOOK_TIMEOUT_MS)

  // Stop every actor a test started so no validation/write keeps running into the next test's cleanup.
  const actors: AnyActorRef[] = []
  const track = <T extends AnyActorRef>(actor: T): T => {
    actors.push(actor)
    return actor
  }

  // Write failures are always logged with console.error; keep the deliberate ones out of the output.
  let consoleError: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(async () => {
    consoleError.mockRestore()
    for (const actor of actors.splice(0)) actor.stop()
    await cleanupTestSchemaData()
  })

  describe('Model write process', () => {
    it('should transition through write states for a model', async () => {
      const actor = track(createActor(writeProcessMachine, {
        input: {
          entityType: 'model',
          entityId: 'test-model-id',
          entityData: {
            modelName: 'TestModel',
            schemaName: 'TestSchema',
            properties: {},
          },
        },
      }))

      actor.start()

      // Should start in idle state
      expect(actor.getSnapshot().value).toBe('idle')

      // Send startWrite event
      actor.send({ type: 'startWrite', data: { modelName: 'TestModel' } })

      // Should transition to validating
      await waitFor(
        actor,
        (snapshot) => snapshot.value === 'validating',
        { timeout: WAIT_TIMEOUT_MS }
      )

      // Should eventually transition to writing or error
      const finalSnapshot = await waitFor(
        actor,
        (snapshot) => snapshot.value === 'writing' || snapshot.value === 'error' || snapshot.value === 'success',
        { timeout: WAIT_TIMEOUT_MS }
      )

      expect(['writing', 'error', 'success']).toContain(finalSnapshot.value)
    })

    it('should handle validation errors', async () => {
      const actor = track(createActor(writeProcessMachine, {
        input: {
          entityType: 'model',
          entityId: 'test-model-id',
          entityData: {
            modelName: '', // Invalid - empty name
            schemaName: 'TestSchema',
          },
        },
      }))

      actor.start()
      actor.send({ type: 'startWrite', data: { modelName: '' } })

      // Should eventually reach error state
      const snapshot = await waitFor(
        actor,
        (snapshot) => snapshot.value === 'error' || snapshot.value === 'idle',
        { timeout: WAIT_TIMEOUT_MS }
      )

      expect(snapshot.value).toBe('error')
      expect(snapshot.context.validationErrors.map((e) => e.code)).toContain('missing_model_name')
    })
  })

  describe('ModelProperty write process', () => {
    it('should validate a property and move on to writing', async () => {
      // Real validation, stubbed DB write: modelId 1 belongs to the Seed Protocol schema, so a real write
      // would add a stray property to it.
      const machine = writeProcessMachine.provide({
        actors: { writeToDatabase: fromCallback(() => () => {}) as any },
      })
      const actor = track(createActor(machine, {
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
      }))

      actor.start()

      // Should start in idle state
      expect(actor.getSnapshot().value).toBe('idle')

      // Send startWrite event
      actor.send({ type: 'startWrite', data: { name: 'testProperty', dataType: 'String' } })

      // Should transition to validating
      await waitFor(
        actor,
        (snapshot) => snapshot.value === 'validating',
        { timeout: WAIT_TIMEOUT_MS }
      )

      const finalSnapshot = await waitFor(
        actor,
        (snapshot) => snapshot.value === 'writing' || snapshot.value === 'error',
        { timeout: WAIT_TIMEOUT_MS }
      )
      expect(finalSnapshot.value).toBe('writing')
      expect(finalSnapshot.context.validationErrors).toEqual([])
    })
  })

  // writeSuccess / writeError are only handled in the `writing` state (they're sent by the writeToDatabase
  // actor). To drive the outcome deterministically, stub the two invoked actors: validation always
  // passes and the write never reports back, so the test sends the result itself.
  const stubbedMachine = writeProcessMachine.provide({
    actors: {
      validateEntity: fromPromise(async () => ({ isValid: true, errors: [] })) as any,
      writeToDatabase: fromCallback(() => () => {}) as any,
    },
  })

  const startStubbedWrite = async () => {
    const actor = track(
      createActor(stubbedMachine, {
        input: {
          entityType: 'model',
          entityId: 'test-model-id',
          entityData: { modelName: 'TestModel', schemaName: 'TestSchema' },
        },
      }),
    )
    actor.start()
    actor.send({ type: 'startWrite', data: { modelName: 'TestModel', schemaName: 'TestSchema' } })
    await waitFor(actor, (snapshot) => snapshot.value === 'writing', { timeout: WAIT_TIMEOUT_MS })
    return actor
  }

  describe('Write outcome', () => {
    it('records and logs a write error', async () => {
      const actor = await startStubbedWrite()

      actor.send({ type: 'writeError', error: new Error('Test error') })
      const errorSnapshot = await waitFor(actor, (snapshot) => snapshot.value === 'error', { timeout: WAIT_TIMEOUT_MS })
      expect(errorSnapshot.context.error?.message).toBe('Test error')
      // A failed persist is otherwise only visible to debug logging
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining('Write error for model "test-model-id": Error: Test error'),
        expect.any(Error),
      )
    })

    it('clears the pending write on success', async () => {
      const actor = await startStubbedWrite()
      expect(actor.getSnapshot().context.pendingWrite).not.toBeNull()

      actor.send({ type: 'writeSuccess' })
      const successSnapshot = await waitFor(actor, (snapshot) => snapshot.value === 'success', { timeout: WAIT_TIMEOUT_MS })
      expect(successSnapshot.context.pendingWrite).toBeNull()
    })
  })
})

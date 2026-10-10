import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { waitFor } from 'xstate'
import { importJsonSchema } from '@/imports/json'
import { Model } from '@/Model/Model'
import { ModelProperty } from '@/ModelProperty/ModelProperty'
import { Schema } from '@/Schema/Schema'
import { generateId } from '@/helpers'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

// Regression: Model/ModelProperty start async work when they're created (schema-name and
// isEdited DB lookups, write retry timers, a delayed refreshProperties). Evicting them with their
// schema (Schema.destroy, cleanupTestSchemaData) stopped the actors but that work still sent to
// them afterwards, so XState warned "Event ... was sent to stopped actor" for each one; a
// 1000-model schema in validation-timeout.test.ts produced thousands of these per run.
testDescribe('evicting a schema stops pending sends to its models and properties', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('sends nothing to evicted Model / ModelProperty actors', async () => {
    const schemaName = `Evict Pending ${generateId()}`
    const models: Record<string, unknown> = {}
    for (let i = 0; i < 20; i++) {
      models[`Model${i}`] = {
        id: generateId(),
        properties: {
          title: { id: generateId(), type: 'Text' },
          count: { id: generateId(), type: 'Number' },
        },
      }
    }
    const schemaFile = {
      $schema: 'https://seedprotocol.org/schemas/data-model/v1',
      version: 1,
      id: generateId(),
      metadata: { name: schemaName, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      models,
      enums: {},
      migrations: [],
    }

    await importJsonSchema({ contents: JSON.stringify(schemaFile) }, schemaFile.version)
    const schema = Schema.create(schemaName, { waitForReady: false })
    await waitFor(schema.getService(), (snapshot) => snapshot.value === 'idle', { timeout: 15000 })

    const warn = vi.spyOn(console, 'warn')
    try {
      // What Schema.destroy and cleanupTestSchemaData do, while the models' startup work is in flight
      const evicted = Model.evictForSchema(schemaName)
      expect(evicted.length).toBeGreaterThan(0)
      ModelProperty.evictForModels(evicted, schemaName)

      // Outlast the in-flight work: DB lookups, 10 x 50ms write retries, the 100ms refreshProperties timer
      await new Promise((resolve) => setTimeout(resolve, 2000))

      const stoppedActorWarnings = warn.mock.calls
        .map((args) => String(args[0]))
        .filter((message) => message.includes('was sent to stopped actor'))
      expect(stoppedActorWarnings).toEqual([])
    } finally {
      warn.mockRestore()
    }
  }, 60000)
})

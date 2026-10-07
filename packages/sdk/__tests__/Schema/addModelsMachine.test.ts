import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createActor, waitFor } from 'xstate'
import { addModelsMachine } from '@/Schema/service/addModelsMachine'
import type { SchemaMachineContext } from '@/Schema/service/schemaMachine'
import { Schema } from '@/Schema/Schema'
import { generateId } from '@/helpers'
import { setupTestEnvironment, teardownTestEnvironment } from '../test-utils/client-init'

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

const schemaContextFor = (schemaName: string) => ({ schemaName }) as SchemaMachineContext

// Regression: every state invoked a fromCallback actor and waited for onDone/onError, which callback
// actors never emit, so the machine sat in `preparing` forever (and schemaMachine in `addingModels`).
testDescribe('addModelsMachine', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: 90000 })
  }, 90000)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('reaches success for valid models', async () => {
    const models = { Note: { properties: { title: { dataType: 'Text' } } } }
    const actor = createActor(addModelsMachine, {
      input: { schemaContext: schemaContextFor(`AddModels ${generateId()}`), models, existingModels: {} },
    }).start()

    const snapshot = await waitFor(actor, (s) => s.status === 'done', { timeout: 15000 })
    expect(snapshot.context.errors).toBeUndefined()
    expect(snapshot.value).toBe('success')
    expect(snapshot.context.modelInstances?.has('Note')).toBe(true)
    expect(snapshot.context.modelFileIds?.get('Note')).toEqual(expect.any(String))
    expect(snapshot.output).toEqual({ addedModels: models })
  }, 30000)

  it('reaches error for invalid models', async () => {
    const actor = createActor(addModelsMachine, {
      input: {
        schemaContext: schemaContextFor(`AddModels ${generateId()}`),
        models: { Note: {} },
        existingModels: {},
      },
    }).start()

    const snapshot = await waitFor(actor, (s) => s.status === 'done', { timeout: 15000 })
    expect(snapshot.value).toBe('error')
    expect(snapshot.context.errors?.[0]?.modelName).toBe('validation')
    expect(snapshot.context.errors?.[0]?.error.message).toMatch(/must have a "properties" object/)
  }, 30000)

  it('reaches error when a model already exists', async () => {
    const actor = createActor(addModelsMachine, {
      input: {
        schemaContext: schemaContextFor(`AddModels ${generateId()}`),
        models: { Note: { properties: {} } },
        existingModels: { Note: { properties: {} } },
      },
    }).start()

    const snapshot = await waitFor(actor, (s) => s.status === 'done', { timeout: 15000 })
    expect(snapshot.value).toBe('error')
    expect(snapshot.context.errors?.[0]?.error.message).toMatch(/already exists/)
  }, 30000)

  it('lets the schema service leave addingModels', async () => {
    const schema = await Schema.create(`AddModels Schema ${generateId()}`, { waitForReady: true })
    const service = schema.getService()
    service.send({ type: 'addModels', models: { Note: { properties: { title: { dataType: 'Text' } } } } })
    expect(service.getSnapshot().value).toBe('addingModels')

    await waitFor(service, (s) => s.value !== 'addingModels', { timeout: 15000 })
    expect(service.getSnapshot().context.models?.Note).toBeDefined()
  }, 30000)
})

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

  // Regression: addModelsMachine's `error` state is final, so the schema saw onDone (never onError),
  // merged nothing, dropped the errors, and validated as if the models had been added.
  it('records addModelsMachine failures on the schema instead of treating them as success', async () => {
    const schema = await Schema.create(`AddModels Schema ${generateId()}`, { waitForReady: true })
    const service = schema.getService()
    service.send({ type: 'addModels', models: { Note: {} } })

    const snapshot = await waitFor(service, (s) => s.value === 'idle', { timeout: 15000 })
    expect(snapshot.context.models?.Note).toBeUndefined()
    expect(snapshot.context._pendingModelAdditions).toBeUndefined()
    expect(snapshot.context._modelAdditionErrors).toHaveLength(1)
    expect(snapshot.context._modelAdditionErrors?.[0]?.error.message).toMatch(/must have a "properties" object/)
  }, 30000)

  // Regression: the queue advanced with an `always` that targeted addingModels from inside itself,
  // which doesn't re-enter, so a request queued behind another never got its own addModelsMachine.
  it('processes an addModels request queued while another is running', async () => {
    const schema = await Schema.create(`AddModels Schema ${generateId()}`, { waitForReady: true })
    const service = schema.getService()
    service.send({ type: 'addModels', models: { Note: { properties: { title: { dataType: 'Text' } } } } })
    service.send({ type: 'addModels', models: { Tag: { properties: { label: { dataType: 'Text' } } } } })

    const snapshot = await waitFor(
      service,
      (s) => s.value === 'idle' && !s.context._pendingModelAdditions,
      { timeout: 15000 },
    )
    expect(snapshot.context.models?.Note).toBeDefined()
    expect(snapshot.context.models?.Tag).toBeDefined()
    expect(snapshot.context._modelAdditionErrors).toBeUndefined()
  }, 30000)
})

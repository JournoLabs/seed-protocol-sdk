// @vitest-environment node
/**
 * Tests for schemaFile config option - loading schema from JSON file on init
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { BaseDb } from '@/db/Db/BaseDb'
import { schemas, models } from '@/seedSchema'
import { eq } from 'drizzle-orm'
import {
  setupTestEnvironment,
  teardownTestEnvironment,
  createTestConfig,
  initializeTestClient,
  SETUP_HOOK_TIMEOUT_MS,
} from '../test-utils/client-init'
import * as fs from 'fs'
import * as path from 'path'
import { createActor, fromCallback, waitFor } from 'xstate'
import { clientManagerMachine } from '@/client/clientManagerMachine'
import { ClientManagerEvents, ClientManagerState } from '@/client/constants'
import { WAIT_TIMEOUT_MS } from '../test-utils/timeouts'

const testDescribe = typeof window === 'undefined'
  ? (describe.sequential || describe)
  : describe.skip

const SCHEMA_NAME = 'SchemaFileInitTest'

testDescribe('schemaFile init', () => {
  describe('when schema file exists', () => {
    beforeAll(async () => {
      if (typeof window !== 'undefined') {
        return
      }
      await setupTestEnvironment({
        testFileUrl: import.meta.url,
        timeout: SETUP_HOOK_TIMEOUT_MS,
        configOverrides: {
          config: { schemaFile: 'schema.json' },
        },
        beforeInit: () => {
          const schemaContent = JSON.stringify({
            name: SCHEMA_NAME,
            models: {
              Article: {
                properties: {
                  title: { type: 'Text' },
                  body: { type: 'Text' },
                },
              },
            },
          })
          const schemaPath = path.join(process.cwd(), 'schema.json')
          fs.writeFileSync(schemaPath, schemaContent)
        },
      })
    }, SETUP_HOOK_TIMEOUT_MS)

    afterAll(async () => {
      if (typeof window !== 'undefined') return
      await teardownTestEnvironment()
    })

    it('loads schema from schemaFile on init', async () => {
      if (typeof window !== 'undefined') return

      const db = BaseDb.getAppDb()
      expect(db).toBeDefined()

      const schemaRows = await db!
        .select()
        .from(schemas)
        .where(eq(schemas.name, SCHEMA_NAME))

      expect(schemaRows.length).toBeGreaterThanOrEqual(1)
      expect(schemaRows[0].name).toBe(SCHEMA_NAME)

      const modelRows = await db!
        .select()
        .from(models)
        .where(eq(models.name, 'Article'))

      expect(modelRows.length).toBeGreaterThanOrEqual(1)
    })

    it('does not create duplicate schemas (idempotent)', async () => {
      if (typeof window !== 'undefined') return

      const db = BaseDb.getAppDb()!
      const schemaRows = await db
        .select()
        .from(schemas)
        .where(eq(schemas.name, SCHEMA_NAME))

      expect(schemaRows.length).toBe(1)
    })
  })

  /**
   * A schema the app passes in config must fail init when it cannot be loaded, not leave a
   * "ready" client with none of its models. The shared Node client is already initialized (and
   * init skips when ready), so these drive the client machine with the real processSchemaFiles
   * actor and the other steps stubbed.
   */
  describe('when the configured schema cannot be loaded', () => {
    let filesDir: string | undefined

    beforeAll(async () => {
      if (typeof window !== 'undefined') return
      await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
      const { client } = await import('@/client')
      filesDir = client.getService().getSnapshot().context.filesDir
    }, SETUP_HOOK_TIMEOUT_MS)

    afterAll(async () => {
      if (typeof window !== 'undefined') return
      await teardownTestEnvironment()
    })

    function schemaProcessingActor(config: { schemaFile?: string; schema?: string }) {
      const succeed = (type: string) => fromCallback(({ sendBack }) => { sendBack({ type }) })
      return createActor(
        clientManagerMachine.provide({
          actors: {
            platformClassesInit: succeed(ClientManagerEvents.PLATFORM_CLASSES_READY),
            fileSystemInit: succeed(ClientManagerEvents.FILE_SYSTEM_READY),
            dbInit: succeed(ClientManagerEvents.DB_READY),
            saveConfig: succeed(ClientManagerEvents.SAVE_CONFIG_SUCCESS),
            addModelsToStore: succeed(ClientManagerEvents.ADD_MODELS_TO_STORE_SUCCESS),
            addModelsToDb: succeed(ClientManagerEvents.ADD_MODELS_TO_DB_SUCCESS),
          },
        }),
        {
          input: {
            isInitialized: false,
            addressesSet: false,
            isSaving: false,
            syncFromEasOnAddressChange: false,
            filesDir,
            ...config,
          },
        },
      )
    }

    async function runInit(config: { schemaFile?: string; schema?: string }) {
      const actor = schemaProcessingActor(config)
      actor.start()
      actor.send({ type: 'init', options: { config: {}, addresses: [] } })
      const snapshot = await waitFor(
        actor,
        (s) => s.value === ClientManagerState.INIT_FAILED || s.value === ClientManagerState.IDLE,
        { timeout: WAIT_TIMEOUT_MS },
      )
      actor.stop()
      return snapshot
    }

    it('fails init when schemaFile does not exist, naming the option and path', async () => {
      if (typeof window !== 'undefined') return

      const snapshot = await runInit({ schemaFile: 'nonexistent-schema.json' })

      expect(snapshot.value).toBe(ClientManagerState.INIT_FAILED)
      expect(String(snapshot.context.initError)).toContain('config.schemaFile')
      expect(String(snapshot.context.initError)).toContain('nonexistent-schema.json')
    })

    it('fails init when schema points at invalid JSON', async () => {
      if (typeof window !== 'undefined') return
      fs.writeFileSync(path.join(process.cwd(), 'broken-schema.json'), '{ not json')

      const snapshot = await runInit({ schema: 'broken-schema.json' })

      expect(snapshot.value).toBe(ClientManagerState.INIT_FAILED)
      expect(String(snapshot.context.initError)).toContain('config.schema')
      expect(String(snapshot.context.initError)).toContain('broken-schema.json')
    })

    it('fails init with the name error when a complete-format schema has no metadata.name', async () => {
      if (typeof window !== 'undefined') return
      fs.writeFileSync(
        path.join(process.cwd(), 'nameless-schema.json'),
        JSON.stringify({
          $schema: 'https://seedprotocol.org/schemas/data-model/v1',
          version: 1,
          metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          models: { Note: { properties: { title: { type: 'Text' } } } },
          enums: {},
          migrations: [],
        }),
      )

      const snapshot = await runInit({ schema: 'nameless-schema.json' })

      expect(snapshot.value).toBe(ClientManagerState.INIT_FAILED)
      const message = String(snapshot.context.initError)
      expect(message).toContain('config.schema')
      expect(message).toContain('Schema name is required')
      expect(message).not.toContain('Failed query')
    })

    it('a later init with a loadable schema succeeds after a failed one', async () => {
      if (typeof window !== 'undefined') return
      const failed = await runInit({ schemaFile: 'nonexistent-schema.json' })
      expect(failed.value).toBe(ClientManagerState.INIT_FAILED)

      fs.writeFileSync(
        path.join(process.cwd(), 'retry-schema.json'),
        JSON.stringify({
          name: `${SCHEMA_NAME}Retry`,
          models: { RetryNote: { properties: { body: { type: 'Text' } } } },
        }),
      )
      const snapshot = await runInit({ schemaFile: 'retry-schema.json' })

      expect(snapshot.context.initError).toBeUndefined()
      expect(snapshot.value).toBe(ClientManagerState.IDLE)
    })
  })
})

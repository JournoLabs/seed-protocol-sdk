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
} from '../test-utils/client-init'
import * as fs from 'fs'
import * as path from 'path'

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
        timeout: 90000,
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
    }, 90000)

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

  describe('when schema file is missing', () => {
    beforeAll(async () => {
      if (typeof window !== 'undefined') {
        return
      }
      await setupTestEnvironment({
        testFileUrl: import.meta.url,
        timeout: 90000,
        configOverrides: {
          config: { schemaFile: 'nonexistent-schema.json' },
        },
      })
    }, 90000)

    afterAll(async () => {
      if (typeof window !== 'undefined') return
      await teardownTestEnvironment()
    })

    it('succeeds without failing (graceful degradation)', async () => {
      if (typeof window !== 'undefined') return

      const db = BaseDb.getAppDb()
      expect(db).toBeDefined()
      // Client initialized successfully despite missing schema file
    })
  })
})

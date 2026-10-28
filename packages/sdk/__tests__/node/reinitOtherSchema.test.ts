// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { client } from '@/client'
import { BaseDb } from '@/db/Db/BaseDb'
import { schemas } from '@/seedSchema/SchemaSchema'
import { Schema } from '@/Schema/Schema'
import { SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

const schemaNamed = (name: string) => ({
  $schema: 'https://seedprotocol.org/schemas/data-model/v1',
  version: 1,
  metadata: { name, createdAt: '2026-10-28T00:00:00.000Z', updatedAt: '2026-10-28T00:00:00.000Z' },
  models: {
    [`${name}Note`]: { properties: { title: { type: 'Text' } } },
  },
})

/**
 * init with one schema, stop, init with another schema in another filesDir: the second database
 * holds only the second schema (batch 14 item 3). It also got the first.
 */
describe('client.init after stop with another schema and filesDir', () => {
  let project: string
  let originalCwd: string

  beforeAll(() => {
    originalCwd = process.cwd()
    project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seed-reinit-')))
    process.chdir(project)
  })

  afterAll(async () => {
    await client.stop()
    process.chdir(originalCwd)
    fs.rmSync(project, { recursive: true, force: true })
  })

  it(
    'leaves the first schema out of the second database',
    async () => {
      await client.init({ config: { filesDir: 'first', schema: schemaNamed('First') } })
      await client.stop()

      await client.init({ config: { filesDir: 'second', schema: schemaNamed('Second') } })
      const db = BaseDb.getAppDb()!
      const names = (await db.select({ name: schemas.name }).from(schemas)).map((r) => r.name)
      expect(names).toContain('Second')
      expect(names).not.toContain('First')

      const loaded = (await Schema.all()).map((s) => s.metadata?.name ?? s.schemaName)
      expect(loaded).not.toContain('First')
    },
    SETUP_HOOK_TIMEOUT_MS * 2,
  )
})

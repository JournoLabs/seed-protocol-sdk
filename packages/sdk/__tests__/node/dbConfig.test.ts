// @vitest-environment node
/**
 * config.dbConfig decides where the Node database and its migrations live. client.init used to drop
 * it (dbInit called prepareDb without it), and a custom outDir got no migration files.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createActor, fromPromise, waitFor } from 'xstate'
import { NodeDb } from '@/node/db/Db'
import { BaseDb } from '@/db/Db/BaseDb'
import { clientManagerMachine } from '@/client/clientManagerMachine'
import { ClientManagerState } from '@/client/constants'
import { WAIT_TIMEOUT_MS } from '../test-utils/timeouts'

describe('config.dbConfig', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('NodeDb.prepareDb puts the database at dbUrl and migrations in outDir', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-dbconfig-'))
    const filesDir = path.join(root, '.seed')
    const dbFile = path.join(root, 'elsewhere', 'app.db')
    const outDir = path.join(root, 'migrations')
    fs.mkdirSync(path.dirname(dbFile), { recursive: true })

    await new NodeDb().prepareDb(filesDir, { dbUrl: dbFile, outDir })

    expect(fs.existsSync(dbFile)).toBe(true)
    expect(fs.existsSync(path.join(outDir, 'meta', '_journal.json'))).toBe(true)
    expect(fs.existsSync(path.join(filesDir, 'db', 'seed.db'))).toBe(false)
  })

  it('client init passes dbConfig to prepareDb', async () => {
    const dbConfig = { dbUrl: '/tmp/seed-dbconfig-test.db', outDir: '/tmp/seed-dbconfig-migrations' }
    const prepareDb = vi.spyOn(BaseDb, 'prepareDb').mockResolvedValue(undefined)
    vi.spyOn(BaseDb, 'getAppDb').mockReturnValue({} as ReturnType<typeof BaseDb.getAppDb>)

    const succeed = () => fromPromise(async () => ({}))
    const actor = createActor(
      clientManagerMachine.provide({
        actors: {
          platformClassesInit: succeed(),
          fileSystemInit: succeed(),
          saveConfig: succeed(),
          processSchemaFiles: succeed(),
          addModelsToDb: succeed(),
        },
      }),
      {
        input: {
          isInitialized: false,
          addressesSet: false,
          isSaving: false,
          syncFromEasOnAddressChange: false,
          filesDir: '.seed',
          dbConfig,
        },
      },
    )
    actor.start()
    actor.send({ type: 'init', options: { config: {}, addresses: [] } })
    const snapshot = await waitFor(
      actor,
      (s) => s.value === ClientManagerState.IDLE || s.value === ClientManagerState.INIT_FAILED,
      { timeout: WAIT_TIMEOUT_MS },
    )
    actor.stop()

    expect(snapshot.context.initError).toBeUndefined()
    expect(prepareDb).toHaveBeenCalledWith('.seed', dbConfig)
  })
})

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { BaseDb } from '@/db/Db/BaseDb'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { seeds, metadata } from '@/seedSchema'
import { createLocalQueryDataSource } from '@/query/createLocalQueryDataSource'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

/**
 * Query hydrates an Html field with the value it has after relation resolution: a gateway URL of
 * the storage seed's transaction, or (with `relations: 'uids'`) the storage seed's uid. The local
 * source finds the body on disk from either.
 */
const SAVED_TX = 'lqsbSavedTx_' + 'a'.repeat(31)
const DOWNLOADED_TX = 'lqsbDownloadTx_' + 'b'.repeat(28)
const STORAGE_SEED_UID = '0x' + 'c4'.repeat(32)
const STORAGE_SEED_LOCAL_ID = 'lqsbHtmlSeed'

describe('local query source readStorageBody', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const db = BaseDb.getAppDb()
    await db.insert(seeds).values({
      localId: STORAGE_SEED_LOCAL_ID,
      uid: STORAGE_SEED_UID,
      type: 'html',
      createdAt: Date.now(),
    })
    await db.insert(metadata).values({
      localId: 'lqsbTxRow',
      propertyName: 'storageTransactionId',
      propertyValue: SAVED_TX,
      modelType: 'html',
      seedLocalId: STORAGE_SEED_LOCAL_ID,
      seedUid: STORAGE_SEED_UID,
      createdAt: Date.now(),
    })
    await BaseFileManager.createDirIfNotExists(BaseFileManager.getFilesPath('html'))
    await BaseFileManager.saveFile(BaseFileManager.getFilesPath('html', `${STORAGE_SEED_LOCAL_ID}.html`), '<p>saved</p>')
    await BaseFileManager.saveFile(BaseFileManager.getFilesPath('html', DOWNLOADED_TX), '<p>downloaded</p>')
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  const read = (value: string) => createLocalQueryDataSource().readStorageBody!({ propertyName: 'html', value })

  it('reads the saved file of the storage seed a gateway URL names', async () => {
    expect(await read(`https://arweave.net/raw/${SAVED_TX}`)).toBe('<p>saved</p>')
    expect(await read(`ar://${SAVED_TX}`)).toBe('<p>saved</p>')
  })

  it('reads a downloaded file named after the transaction', async () => {
    expect(await read(`https://ar.example/raw/${DOWNLOADED_TX}`)).toBe('<p>downloaded</p>')
  })

  it('reads the saved file of a storage seed given by uid', async () => {
    expect(await read(STORAGE_SEED_UID)).toBe('<p>saved</p>')
  })

  it('returns null for a transaction with no local file', async () => {
    expect(await read(`https://arweave.net/raw/${'z'.repeat(43)}`)).toBeNull()
  })
})

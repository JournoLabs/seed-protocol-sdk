import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../../test-utils/client-init'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata } from '@/seedSchema'
import { generateId } from '@/helpers'
import { getCompositeChildPaths } from '@/db/read/getCompositeChildPaths'

/**
 * The download worker saves each composite child where hydration reads that ItemStorage property:
 * `<localStorageDir>/<refResolvedValue>` of the row sync derived from the storage transaction.
 */
describe.sequential('getCompositeChildPaths', () => {
  const tx = (c: string) => c.repeat(43)
  const TX_A = tx('a')
  const TX_B = tx('b')
  const TX_NONE = tx('c')

  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const derived = (
      propertyName: string,
      txId: string,
      localStorageDir: string | null,
      extension: string,
    ) => ({
      localId: generateId(),
      propertyName,
      propertyValue: txId,
      localStorageDir,
      refValueType: 'file',
      refResolvedValue: `${txId}${extension}`,
      seedLocalId: generateId(),
      derivedFromUid: '0x' + '1'.repeat(64),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    await BaseDb.getAppDb()
      .insert(metadata)
      .values([
        // Rows sync derives for a model with html, a binary cover and markdown notes.
        derived('html', TX_A, '/html', '.html'),
        derived('cover', TX_A, '/covers', '.bin'),
        derived('notes', TX_A, null, '.md'),
        derived('html', TX_B, '/html', '.html'),
        // A local draft that happens to hold a transaction id as its value: not a derived row.
        { ...derived('cover', TX_B, '/covers', '.bin'), derivedFromUid: null },
        // Not a file name: not a path the SDK would read.
        derived('json', TX_B, '/json', '/../escape.json'),
      ])
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('maps each derived child to its storage dir and file name', async () => {
    expect(await getCompositeChildPaths([TX_A, TX_B, TX_NONE])).toEqual({
      [TX_A]: {
        html: `html/${TX_A}.html`,
        cover: `covers/${TX_A}.bin`,
        notes: `files/${TX_A}.md`,
      },
      [TX_B]: { html: `html/${TX_B}.html` },
    })
  })

  it('returns nothing for no transactions', async () => {
    expect(await getCompositeChildPaths([])).toEqual({})
  })
})

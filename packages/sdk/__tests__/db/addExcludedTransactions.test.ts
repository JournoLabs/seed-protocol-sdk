import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { appState } from '@/seedSchema'
import { addExcludedTransactions } from '@/db/write/addExcludedTransactions'
import { setupTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

describe('addExcludedTransactions', () => {
  let original: string | undefined

  const stored = async () => {
    const rows = await BaseDb.getAppDb()!.select().from(appState).where(eq(appState.key, 'excludedTransactions'))
    return rows[0] ? (JSON.parse(rows[0].value as string) as string[]) : undefined
  }

  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const rows = await BaseDb.getAppDb()!.select().from(appState).where(eq(appState.key, 'excludedTransactions'))
    original = rows[0]?.value as string | undefined
    await BaseDb.getAppDb()!.delete(appState).where(eq(appState.key, 'excludedTransactions'))
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    const db = BaseDb.getAppDb()!
    await db.delete(appState).where(eq(appState.key, 'excludedTransactions'))
    if (original !== undefined) await db.insert(appState).values({ key: 'excludedTransactions', value: original })
  })

  it('keeps ids added by concurrent writers', async () => {
    // Two downloads (or tabs) finishing together: each used to write the list it read earlier.
    await Promise.all([
      addExcludedTransactions(['tx-a', 'tx-b']),
      addExcludedTransactions(['tx-c']),
      addExcludedTransactions(['tx-b', 'tx-d']),
    ])
    expect((await stored())!.sort()).toEqual(['tx-a', 'tx-b', 'tx-c', 'tx-d'])
  })

  it('adds to the existing list', async () => {
    await addExcludedTransactions(['tx-e'])
    expect(await stored()).toContain('tx-a')
    expect(await stored()).toContain('tx-e')
  })
})

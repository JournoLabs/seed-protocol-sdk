import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { seeds, versions } from '@/seedSchema'
import { deleteItem } from '@/db/write/deleteItem'
import { getItemsData } from '@/db/read/getItems'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../../test-utils/client-init'

const uid = (c: string) => '0x' + c.repeat(64)

describe.sequential('deleteItem', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  const db = () => BaseDb.getAppDb()
  const markOf = async (localId: string) =>
    (await db().select({ m: seeds._markedForDeletion }).from(seeds).where(eq(seeds.localId, localId)))[0]?.m

  it('soft-deletes only the row with the given localId when another row shares its uid', async () => {
    const t = Date.now()
    const shared = uid('d')
    await db().insert(seeds).values([
      { localId: `del-a-${t}`, type: 'post', uid: shared, createdAt: t },
      { localId: `del-b-${t}`, type: 'post', uid: shared, createdAt: t },
    ])

    await deleteItem({ seedLocalId: `del-a-${t}`, seedUid: shared })

    expect(await markOf(`del-a-${t}`)).toBe(1)
    expect(await markOf(`del-b-${t}`)).toBeNull()
  })

  it('falls back to uid when no localId is given', async () => {
    const t = Date.now()
    const only = uid('e')
    await db().insert(seeds).values([{ localId: `del-c-${t}`, type: 'post', uid: only, createdAt: t }])

    await deleteItem({ seedUid: only })

    expect(await markOf(`del-c-${t}`)).toBe(1)
  })

  it('getItemsData({ deleted: true }) lists rows marked 1, not rows marked 0', async () => {
    const t = Date.now()
    const type = `delfilter${t}`
    await db().insert(seeds).values([
      { localId: `del-zero-${t}`, type, createdAt: t, _markedForDeletion: 0 },
      { localId: `del-one-${t}`, type, createdAt: t, _markedForDeletion: 1 },
    ])
    await db().insert(versions).values([
      { localId: `delv-zero-${t}`, seedLocalId: `del-zero-${t}`, seedType: type, createdAt: t },
      { localId: `delv-one-${t}`, seedLocalId: `del-one-${t}`, seedType: type, createdAt: t },
    ])

    const deleted = await getItemsData({ modelName: type, deleted: true })
    const live = await getItemsData({ modelName: type })
    expect(deleted.map((r) => r.seedLocalId)).toEqual([`del-one-${t}`])
    expect(live.map((r) => r.seedLocalId)).toEqual([`del-zero-${t}`])

    await db().delete(versions).where(inArray(versions.seedLocalId, [`del-zero-${t}`, `del-one-${t}`]))
  })
})

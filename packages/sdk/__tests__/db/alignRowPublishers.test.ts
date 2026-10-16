import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { keepAttestationsFromRefAttester } from '@seedprotocol/eas'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata, seeds, versions } from '@/seedSchema'
import { alignRowPublishers } from '@/db/alignRowPublishers'
import { createLocalQueryDataSource } from '@/query/createLocalQueryDataSource'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

const A = '0x' + 'a1'.repeat(20)
const B = '0x' + 'b2'.repeat(20)
const uid = (c: string) => '0x' + c.repeat(64)

describe.sequential('alignRowPublishers', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  const db = () => BaseDb.getAppDb()
  const publisherOf = async (table: typeof versions | typeof metadata, localId: string) =>
    (await db().select({ publisher: table.publisher }).from(table).where(eq(table.localId, localId)))[0]?.publisher

  it("gives rows without a stored attestation their seed's publisher, and leaves synced rows alone", async () => {
    const t = Date.now()
    await db().insert(seeds).values([
      { localId: `s-a-${t}`, type: 'post', publisher: A, createdAt: t },
      { localId: `s-none-${t}`, type: 'post', publisher: null, createdAt: t },
      {
        localId: `s-synced-${t}`,
        type: 'post',
        uid: uid('1'),
        attestationRaw: JSON.stringify({ attester: A }),
        createdAt: t,
      },
    ])
    await db().insert(versions).values([
      { localId: `v-a-${t}`, seedLocalId: `s-a-${t}`, seedType: 'post', publisher: B, createdAt: t },
      { localId: `v-none-${t}`, seedLocalId: `s-none-${t}`, seedType: 'post', publisher: B, createdAt: t },
    ])
    await db().insert(metadata).values([
      // An edit's row from before: no publisher under A's seed.
      { localId: `m-blank-${t}`, seedLocalId: `s-a-${t}`, propertyName: 'title', createdAt: t },
      // Claimed by another wallet.
      { localId: `m-claimed-${t}`, seedLocalId: `s-a-${t}`, propertyName: 'body', publisher: B, createdAt: t },
      // A seed that belongs to no wallet: its unsealed row loses the stray publisher.
      { localId: `m-none-${t}`, seedLocalId: `s-none-${t}`, propertyName: 'title', publisher: B, createdAt: t },
      // Publisher from the seed's stored attestation.
      { localId: `m-from-raw-${t}`, seedLocalId: `s-synced-${t}`, propertyName: 'title', createdAt: t },
      // Synced: its attester is in attestation_raw, so it's left as it is.
      {
        localId: `m-synced-${t}`,
        seedLocalId: `s-synced-${t}`,
        uid: uid('2'),
        propertyName: 'body',
        publisher: B,
        attestationRaw: JSON.stringify({ attester: B }),
        createdAt: t,
      },
    ])

    const result = await alignRowPublishers()

    expect(await publisherOf(versions, `v-a-${t}`)).toBe(A)
    expect(await publisherOf(versions, `v-none-${t}`)).toBeNull()
    expect(await publisherOf(metadata, `m-blank-${t}`)).toBe(A)
    expect(await publisherOf(metadata, `m-claimed-${t}`)).toBe(A)
    expect(await publisherOf(metadata, `m-none-${t}`)).toBeNull()
    expect((await publisherOf(metadata, `m-from-raw-${t}`))?.toLowerCase()).toBe(A)
    expect(await publisherOf(metadata, `m-synced-${t}`)).toBe(B)
    expect(result.versionRows).toBeGreaterThanOrEqual(2)
    expect(result.propertyRows).toBeGreaterThanOrEqual(4)

    // Run again: nothing left to change.
    expect(await alignRowPublishers()).toEqual({ versionRows: 0, propertyRows: 0 })
  })

  it('a published property row claimed by another wallet is back in local query reads', async () => {
    const t = Date.now()
    const seedUid = uid('3')
    const versionUid = uid('4')
    const propertyUid = uid('5')
    await db().insert(seeds).values({ localId: `qs-${t}`, type: 'post', uid: seedUid, publisher: A, createdAt: t })
    await db()
      .insert(versions)
      .values({ localId: `qv-${t}`, seedLocalId: `qs-${t}`, seedUid, seedType: 'post', uid: versionUid, publisher: A, createdAt: t })
    // A's edit, claimed by B before A published it (publish keeps a publisher once set).
    await db().insert(metadata).values({
      localId: `qm-${t}`,
      seedLocalId: `qs-${t}`,
      seedUid,
      versionUid,
      uid: propertyUid,
      propertyName: 'title',
      propertyValue: 'published by A',
      publisher: B,
      createdAt: t,
    })

    const source = createLocalQueryDataSource()
    const read = async () => {
      const itemVersions = await source.getVersionsForSeeds([seedUid])
      const properties = await source.getPropertiesForVersionUids([versionUid])
      // What assembleSeeds keeps: properties whose attester is their version's.
      return keepAttestationsFromRefAttester(properties, itemVersions).map((att) => att.id)
    }

    expect(await read()).not.toContain(propertyUid)
    await alignRowPublishers()
    expect(await read()).toContain(propertyUid)
  })
})

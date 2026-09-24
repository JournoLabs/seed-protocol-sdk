import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata, seeds, versions } from '@/seedSchema'
import { eq } from 'drizzle-orm'
import { getItemsData } from '@/db/read/getItems'
import { isItemOwned } from '@/helpers/ownership'
import { getAddressesForItemsFilter } from '@/helpers/db'
import { setAdditionalSyncAddresses } from '@/helpers/publishConfig'
import { claimUnpublishedDrafts } from '@/db/write/claimUnpublishedDrafts'
import {
  setupTestEnvironment,
  teardownTestEnvironment,
} from '../test-utils/client-init'

const testDescribe = typeof window === 'undefined' ? describe.sequential : describe

const OWNED = '0xabc0000000000000000000000000000000000001'
const OWNED_CHECKSUM = '0xAbC0000000000000000000000000000000000001'
const MODULE = '0xmod0000000000000000000000000000000000002'
const REAL_UID = '0x' + 'c'.repeat(64)

async function insertListedSeed(opts: {
  localId: string
  publisher?: string | null
  uid?: string | null
  attestationRaw?: string | null
}) {
  const db = BaseDb.getAppDb()
  const t = Date.now()
  await db.insert(seeds).values({
    localId: opts.localId,
    uid: opts.uid ?? null,
    type: 'post',
    publisher: opts.publisher ?? null,
    attestationRaw: opts.attestationRaw ?? null,
    createdAt: t,
  })
  await db.insert(versions).values({
    localId: `${opts.localId}-ver`,
    seedLocalId: opts.localId,
    seedUid: opts.uid ?? null,
    seedType: 'post',
    uid: opts.uid ?? null,
    publisher: opts.publisher ?? null,
    createdAt: t,
  })
}

testDescribe('ownership address policy', () => {
  beforeAll(async () => {
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: 120000,
      configOverrides: {
        syncFromEasOnAddressChange: false,
      },
    })
  }, 120000)

  afterAll(async () => {
    setAdditionalSyncAddresses(null)
    await teardownTestEnvironment()
  })

  it('persists setAddresses mixed-case as lowercase and empty owned', async () => {
    const { client } = await import('@/client')
    await client.setAddresses({
      owned: [OWNED_CHECKSUM, OWNED],
      watched: ['0xWatched00000000000000000000000000000001'],
    })
    expect(await client.getAddresses()).toEqual({
      owned: [OWNED],
      watched: ['0xwatched00000000000000000000000000000001'],
    })

    await client.setAddresses({ owned: [] })
    expect(await client.getAddresses()).toEqual({ owned: [], watched: [] })
  })

  it('empty owned + addressFilter owned returns no rows', async () => {
    const { client } = await import('@/client')
    const localId = `empty-owned-${Date.now()}`
    await insertListedSeed({ localId, publisher: OWNED })
    await client.setAddresses({ owned: [] })

    const rows = await getItemsData({ includeEas: true, addressFilter: 'owned' })
    expect(rows).toEqual([])
  })

  it('matches checksummed publisher to lowercase owned and excludes nulls', async () => {
    const { client } = await import('@/client')
    const t = Date.now()
    const checksumId = `checksum-${t}`
    const nullUidId = `null-uid-${t}`
    const draftId = `draft-${t}`
    await insertListedSeed({
      localId: checksumId,
      publisher: OWNED_CHECKSUM,
      uid: REAL_UID,
    })
    await insertListedSeed({
      localId: nullUidId,
      publisher: null,
      uid: '0x' + 'd'.repeat(64),
    })
    await insertListedSeed({ localId: draftId, publisher: null, uid: null })

    await client.setAddresses({ owned: [OWNED] })

    const rows = await getItemsData({ includeEas: true, addressFilter: 'owned' })
    const ids = rows.map((r) => r.seedLocalId)
    expect(ids).toContain(checksumId)
    expect(ids).not.toContain(nullUidId)
    expect(ids).not.toContain(draftId)
  })

  it('isItemOwned uses the same set/case/null policy, with empty-owned draft exception', async () => {
    const { client } = await import('@/client')
    const t = Date.now()
    const draftId = `owned-draft-${t}`
    const stampedId = `owned-stamped-${t}`
    await insertListedSeed({ localId: draftId, publisher: null, uid: null })
    await insertListedSeed({
      localId: stampedId,
      publisher: OWNED_CHECKSUM,
      uid: REAL_UID,
    })

    await client.setAddresses({ owned: [] })
    expect(await isItemOwned({ seedLocalId: draftId })).toBe(true)
    expect(await isItemOwned({ seedLocalId: stampedId })).toBe(false)

    await client.setAddresses({ owned: [OWNED] })
    expect(await isItemOwned({ seedLocalId: draftId })).toBe(false)
    expect(await isItemOwned({ seedLocalId: stampedId })).toBe(true)
  })

  it('claimUnpublishedDrafts stamps unsealed rows and skips sealed', async () => {
    const { client } = await import('@/client')
    const t = Date.now()
    const draftId = `claim-draft-${t}`
    const sealedId = `claim-sealed-${t}`
    await insertListedSeed({ localId: draftId, publisher: null, uid: null })
    await insertListedSeed({
      localId: sealedId,
      publisher: null,
      uid: '0x' + 'e'.repeat(64),
      attestationRaw: JSON.stringify({ attester: '0xsomeone' }),
    })

    const db = BaseDb.getAppDb()
    await db.insert(metadata).values({
      localId: `${draftId}-meta`,
      seedLocalId: draftId,
      propertyName: 'title',
      propertyValue: 'draft',
      createdAt: t,
    })
    await db.insert(metadata).values({
      localId: `${sealedId}-meta`,
      seedLocalId: sealedId,
      uid: '0x' + 'f'.repeat(64),
      propertyName: 'title',
      propertyValue: 'sealed',
      createdAt: t,
    })

    const result = await client.claimUnpublishedDrafts(OWNED_CHECKSUM)
    expect(result.seeds).toBeGreaterThanOrEqual(1)
    expect(result.versions).toBeGreaterThanOrEqual(1)
    expect(result.metadata).toBeGreaterThanOrEqual(1)

    const [draft] = await db
      .select({ publisher: seeds.publisher })
      .from(seeds)
      .where(eq(seeds.localId, draftId))
    const [sealed] = await db
      .select({ publisher: seeds.publisher })
      .from(seeds)
      .where(eq(seeds.localId, sealedId))
    expect(draft?.publisher).toBe(OWNED)
    expect(sealed?.publisher).toBeNull()

    await client.setAddresses({ owned: [OWNED] })
    expect(await isItemOwned({ seedLocalId: draftId })).toBe(true)
    expect(await isItemOwned({ seedLocalId: sealedId })).toBe(false)
  })

  it('does not treat additional sync / module contract as owned', async () => {
    const { client } = await import('@/client')
    setAdditionalSyncAddresses(async () => [MODULE])
    try {
      await client.setAddresses({ owned: [OWNED] })
      expect(await getAddressesForItemsFilter('owned')).toEqual([OWNED])

      const moduleId = `module-${Date.now()}`
      await insertListedSeed({
        localId: moduleId,
        publisher: MODULE,
        uid: REAL_UID,
      })

      expect(await isItemOwned({ seedLocalId: moduleId })).toBe(false)
      const rows = await getItemsData({ includeEas: true, addressFilter: 'owned' })
      expect(rows.map((r) => r.seedLocalId)).not.toContain(moduleId)
    } finally {
      setAdditionalSyncAddresses(null)
    }
  })

  it('claimUnpublishedDrafts helper lowercases the stamp', async () => {
    const t = Date.now()
    const localId = `claim-helper-${t}`
    await insertListedSeed({ localId, publisher: null, uid: null })
    const result = await claimUnpublishedDrafts(OWNED_CHECKSUM)
    expect(result.seeds).toBeGreaterThanOrEqual(1)
    const db = BaseDb.getAppDb()
    const [row] = await db
      .select({ publisher: seeds.publisher })
      .from(seeds)
      .where(eq(seeds.localId, localId))
    expect(row?.publisher).toBe(OWNED)
  })
})

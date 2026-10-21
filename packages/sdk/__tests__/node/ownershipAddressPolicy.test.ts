import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata, seeds, versions } from '@/seedSchema'
import { eq } from 'drizzle-orm'
import { getItemsData } from '@/db/read/getItems'
import { isItemOwned, isSeedRowOwned, type SeedOwnershipRow } from '@/helpers/ownership'
import { ZERO_BYTES32 } from '@/helpers/constants'
import { getAddressesForItemsFilter } from '@/helpers/db'
import { setAdditionalSyncAddresses } from '@/helpers/publishConfig'
import { claimUnpublishedDrafts } from '@/db/write/claimUnpublishedDrafts'
import {
  setupTestEnvironment,
  teardownTestEnvironment,
  SETUP_HOOK_TIMEOUT_MS,
} from '../test-utils/client-init'

const testDescribe = typeof window === 'undefined' ? describe.sequential : describe

const OWNED = '0xabc0000000000000000000000000000000000001'
const OWNED_CHECKSUM = '0xAbC0000000000000000000000000000000000001'
const MODULE = '0xmod0000000000000000000000000000000000002'
// A new attested uid per call: seeds.uid is unique (migration 0029).
const realUid = () =>
  '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')

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
      timeout: SETUP_HOOK_TIMEOUT_MS,
      configOverrides: {
        syncFromEasOnAddressChange: false,
      },
    })
  }, SETUP_HOOK_TIMEOUT_MS)

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

  it('empty owned + addressFilter owned lists only local unsealed drafts', async () => {
    const { client } = await import('@/client')
    const t = Date.now()
    const stampedId = `empty-owned-${t}`
    const draftId = `empty-owned-draft-${t}`
    await insertListedSeed({ localId: stampedId, publisher: OWNED })
    await insertListedSeed({ localId: draftId, publisher: null, uid: null })
    await client.setAddresses({ owned: [] })

    const rows = await getItemsData({ includeEas: true, addressFilter: 'owned' })
    const ids = rows.map((r) => r.seedLocalId)
    expect(ids).toContain(draftId)
    expect(ids).not.toContain(stampedId)
    expect(await isItemOwned({ seedLocalId: draftId })).toBe(true)
  })

  it('addressFilter owned lists a row exactly when isSeedRowOwned is true', async () => {
    const { client } = await import('@/client')
    const prefix = `parity-${Date.now()}-`
    const OTHER = '0xdef0000000000000000000000000000000000009'
    const raw = (attester: string) => JSON.stringify({ attester })
    const cases: Record<string, SeedOwnershipRow> = {
      draftNull: { publisher: null, uid: null, attestationRaw: null },
      draftBlank: { publisher: '', uid: '', attestationRaw: '' },
      draftNULL: { publisher: null, uid: 'NULL', attestationRaw: null },
      draftZero: { publisher: null, uid: ` ${ZERO_BYTES32} `, attestationRaw: null },
      draftClaimed: { publisher: OWNED, uid: null, attestationRaw: null },
      stampedOwned: { publisher: OWNED_CHECKSUM, uid: realUid(), attestationRaw: null },
      stampedOther: { publisher: OTHER, uid: realUid(), attestationRaw: null },
      realUidNoPublisher: { publisher: null, uid: realUid(), attestationRaw: null },
      attesterOwned: { publisher: null, uid: realUid(), attestationRaw: raw(OWNED_CHECKSUM) },
      attesterOwnedBlankPublisher: { publisher: '', uid: realUid(), attestationRaw: raw(OWNED) },
      attesterOther: { publisher: null, uid: realUid(), attestationRaw: raw(OTHER) },
      attesterNoUid: { publisher: null, uid: null, attestationRaw: raw(OWNED) },
      attesterMissing: { publisher: null, uid: realUid(), attestationRaw: '{}' },
      malformedRaw: { publisher: null, uid: realUid(), attestationRaw: 'not json' },
      publisherWinsOverAttester: { publisher: OTHER, uid: realUid(), attestationRaw: raw(OWNED) },
    }
    for (const [name, row] of Object.entries(cases)) {
      await insertListedSeed({ localId: `${prefix}${name}`, ...row })
    }

    for (const owned of [[], [OWNED], [OWNED_CHECKSUM, OTHER]]) {
      await client.setAddresses({ owned })
      const persisted = await getAddressesForItemsFilter('owned')
      const rows = await getItemsData({ includeEas: true, addressFilter: 'owned' })
      const listed = rows
        .map((r) => r.seedLocalId)
        .filter((id): id is string => !!id && id.startsWith(prefix))
        .map((id) => id.slice(prefix.length))
        .sort()
      const expected = Object.entries(cases)
        .filter(([, row]) => isSeedRowOwned(row, persisted))
        .map(([name]) => name)
        .sort()
      expect({ owned, listed }).toEqual({ owned, listed: expected })
    }
  })

  it('matches checksummed publisher to lowercase owned; a real uid without publisher is excluded', async () => {
    const { client } = await import('@/client')
    const t = Date.now()
    const checksumId = `checksum-${t}`
    const nullUidId = `null-uid-${t}`
    const draftId = `draft-${t}`
    await insertListedSeed({
      localId: checksumId,
      publisher: OWNED_CHECKSUM,
      uid: realUid(),
    })
    await insertListedSeed({
      localId: nullUidId,
      publisher: null,
      uid: realUid(),
    })
    await insertListedSeed({ localId: draftId, publisher: null, uid: null })

    await client.setAddresses({ owned: [OWNED] })

    const rows = await getItemsData({ includeEas: true, addressFilter: 'owned' })
    const ids = rows.map((r) => r.seedLocalId)
    expect(ids).toContain(checksumId)
    expect(ids).not.toContain(nullUidId)
    // A local draft with no publisher belongs to no wallet yet, so it's listed as owned.
    expect(ids).toContain(draftId)
  })

  it('isItemOwned uses the same set/case policy; local drafts with no publisher are always owned', async () => {
    const { client } = await import('@/client')
    const t = Date.now()
    const draftId = `owned-draft-${t}`
    const stampedId = `owned-stamped-${t}`
    await insertListedSeed({ localId: draftId, publisher: null, uid: null })
    await insertListedSeed({
      localId: stampedId,
      publisher: OWNED_CHECKSUM,
      uid: realUid(),
    })

    await client.setAddresses({ owned: [] })
    expect(await isItemOwned({ seedLocalId: draftId })).toBe(true)
    expect(await isItemOwned({ seedLocalId: stampedId })).toBe(false)

    await client.setAddresses({ owned: [OWNED] })
    expect(await isItemOwned({ seedLocalId: draftId })).toBe(true)
    expect(await isItemOwned({ seedLocalId: stampedId })).toBe(true)
  })

  it('isItemOwned falls back to the uid when the localId has no row', async () => {
    const { client } = await import('@/client')
    const t = Date.now()
    await client.setAddresses({ owned: [OWNED] })
    const fallbackUid = realUid()
    await insertListedSeed({ localId: `owned-fallback-${t}`, publisher: OWNED, uid: fallbackUid })
    expect(await isItemOwned({ seedLocalId: `missing-${t}`, seedUid: fallbackUid })).toBe(true)
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
      uid: realUid(),
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
        uid: realUid(),
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

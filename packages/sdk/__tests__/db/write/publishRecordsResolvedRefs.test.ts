import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { Item } from '@/Item/Item'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { BaseArweaveClient } from '@seedprotocol/arweave'
import { getPublishPayload } from '@/db/read/getPublishPayload'
import { getItemProperties } from '@/db/read/getItemProperties'
import { applyPropertyAttestationUidsFromPublish } from '@/db/write/applyPropertyAttestationUidsFromPublish'
import { updateVersionUid } from '@/db/write/updateVersionUid'
import { updateSeedUid } from '@/db/write/updateSeedUid'
import { getPublishPendingDiff } from '@/db/read/getPublishPendingDiff'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata, seeds } from '@/seedSchema'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../../test-utils/client-init'
import {
  ensureModelUidsForGetPublishPayloadTest,
  ensurePropertySchemaUidsForGetPublishPayloadTest,
  waitForPropertyInstances,
} from '../../test-utils/getPublishPayloadIntegrationHelpers'
import { waitForIdle } from '../../test-utils/waitForIdle'

/**
 * What the local item layer holds after a publish whose relation / list-of-relation values named
 * drafts published with it: those slots were attested as the drafts' new seed uids, so the attested
 * metadata rows hold the seed uids too, as an EAS sync of the same attestations would write them
 * (a list: JSON bytes32[] of seed uids; a relation: the seed uid). Both publish paths' recording
 * orders are replayed with the real SDK writers (the publish package is mocked out of the SDK tests):
 * - contract (multiPublish receipt): every request's property uids, then the related seed uids;
 * - direct-to-EAS: each request's property uids as it is sent, the related seed uids at the end.
 */
const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.sequential

const SCHEMA_NAME = 'Test Schema publishRecordsResolvedRefs'
const PUBLISHER = '0x' + '5c'.repeat(20)
/** `members` (List of Relation to PubRecMember) is stored as singular + ref + Ids. */
const LIST_STORAGE_NAME = 'memberPubRecMemberIds'

const schemaFile = () => ({
  $schema: 'https://seedprotocol.org/schemas/data-model/v1',
  version: 1,
  id: generateId(),
  metadata: { name: SCHEMA_NAME, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  models: {
    PubRecMember: {
      id: generateId(),
      properties: {
        label: { id: generateId(), type: 'Text' },
      },
    },
    PubRecHolder: {
      id: generateId(),
      properties: {
        title: { id: generateId(), type: 'Text' },
        lead: { id: generateId(), type: 'Relation', model: 'PubRecMember' },
        members: { id: generateId(), type: 'List', refValueType: 'Relation', ref: 'PubRecMember' },
      },
    },
  },
  enums: {},
  migrations: [],
})

let uidCounter = 0
const nextUid = (): string => {
  uidCounter += 1
  const tail = `${Date.now().toString(16)}${uidCounter.toString(16).padStart(4, '0')}`
  return '0x' + ('7e3b5d' + tail).padEnd(64, 'd')
}
const ZERO = '0x' + '0'.repeat(64)
const isZero = (uid: unknown) => !uid || String(uid).toLowerCase() === ZERO

const createItem = async (props: Record<string, unknown>) => {
  const item = await Item.create({ schemaName: SCHEMA_NAME, ...props } as any)
  await waitForIdle(item, 'Item', 15000)
  await waitForPropertyInstances(item)
  return item
}

type Path = 'contract' | 'direct'

/**
 * Replays the local recording of a publish of `root` (seeds/versions/property attestations get fake
 * uids) in `path`'s order, with `resolvedSeedUids` passed as each path passes it. Returns the seed
 * uid each request got.
 */
const replayPublish = async (root: Item<any>, path: Path) => {
  const payload = (await getPublishPayload(root as any, [])) as any[]
  const seedUids: Record<string, string> = {}
  const versionUids: Record<string, string> = {}
  for (const req of payload) {
    seedUids[req.localId] = isZero(req.seedUid) ? nextUid() : req.seedUid
    versionUids[req.localId] = isZero(req.versionUid) ? nextUid() : req.versionUid
  }
  const ms = Date.now()
  const pairsOf = (req: any) =>
    req.listOfAttestations.map((att: any) => ({
      schemaUid: att.schema,
      attestationUid: nextUid(),
      propertyName: att._propertyName,
    }))
  const recordVersion = (req: any) =>
    updateVersionUid({
      seedLocalId: req.localId,
      versionUid: versionUids[req.localId]!,
      publisher: PUBLISHER,
      attestationCreatedAt: ms,
    })
  const recordSeed = async (req: any) => {
    const found = await Item.find({ seedLocalId: req.localId } as any)
    ;(found as any).seedUid = seedUids[req.localId]
    await (found as any).persistSeedUid(PUBLISHER, ms)
  }

  if (path === 'contract') {
    for (const req of payload) await recordVersion(req)
    for (const req of payload) {
      await applyPropertyAttestationUidsFromPublish({
        seedLocalId: req.localId,
        attestationCreatedAtMs: ms,
        versionUid: versionUids[req.localId]!,
        pairs: pairsOf(req),
        resolvedSeedUids: seedUids,
      })
    }
  } else {
    const resolvedSoFar: Record<string, string> = {}
    for (const req of payload) {
      resolvedSoFar[req.localId] = seedUids[req.localId]!
      await recordVersion(req)
      await applyPropertyAttestationUidsFromPublish({
        seedLocalId: req.localId,
        attestationCreatedAtMs: ms,
        versionUid: versionUids[req.localId]!,
        pairs: pairsOf(req),
        resolvedSeedUids: { ...resolvedSoFar },
      })
    }
  }
  for (const req of payload) await recordSeed(req)
  return { payload, seedUids, versionUids }
}

const latestRow = async (seedLocalId: string, propertyName: string) => {
  const props = await getItemProperties({ seedLocalId })
  return props.find((p: any) => p.propertyName === propertyName) as any
}

testDescribe('publish records relation and list values as the attested seed uids', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const schema = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(schema) }, schema.version)
    await ensureModelUidsForGetPublishPayloadTest(['PubRecHolder', 'PubRecMember'], SCHEMA_NAME)
    await ensurePropertySchemaUidsForGetPublishPayloadTest(schema as any)
    vi.spyOn(BaseArweaveClient, 'createTransaction').mockImplementation(async () => ({ id: 'unsigned', tags: [] }) as any)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    vi.restoreAllMocks()
    await teardownTestEnvironment()
  })

  for (const path of ['contract', 'direct'] as const) {
    it(`${path} path: list members and the relation to drafts hold their new seed uids`, async () => {
      // One member was published before (the list names it by local id; it attests its uid).
      const known = await createItem({ modelName: 'PubRecMember', label: `${path} known` })
      const knownUid = nextUid()
      await updateSeedUid({ seedLocalId: known.seedLocalId, seedUid: knownUid, publisher: PUBLISHER })
      const m1 = await createItem({ modelName: 'PubRecMember', label: `${path} m1` })
      const m2 = await createItem({ modelName: 'PubRecMember', label: `${path} m2` })
      const lead = await createItem({ modelName: 'PubRecMember', label: `${path} lead` })
      const root = await createItem({
        modelName: 'PubRecHolder',
        title: `${path} holder`,
        lead: lead.seedLocalId,
        members: [m1.seedLocalId, known.seedLocalId, m2.seedLocalId],
      })

      const { payload, seedUids, versionUids } = await replayPublish(root, path)
      expect(payload.map((r) => r.localId)).not.toContain(known.seedLocalId)
      const rootVersion = versionUids[root.seedLocalId]!

      // Every member is mapped to its new seed uid.
      const db = BaseDb.getAppDb()
      for (const m of [m1, m2, lead]) {
        const [row] = await db.select({ uid: seeds.uid }).from(seeds).where(eq(seeds.localId, m.seedLocalId))
        expect(row?.uid).toBe(seedUids[m.seedLocalId])
      }

      // The list (stored under its storage name): attested on the published version, holding what
      // sync writes for the bytes32[] attestation, a JSON array of the seed uids in slot order.
      const expectedList = JSON.stringify([seedUids[m1.seedLocalId], knownUid, seedUids[m2.seedLocalId]])
      const members = await latestRow(root.seedLocalId, LIST_STORAGE_NAME)
      expect(members.uid).toMatch(/^0x[0-9a-f]{64}$/)
      expect(members.versionUid).toBe(rootVersion)
      expect(members.propertyValue).toBe(expectedList)
      expect(
        (await getPublishPendingDiff({ seedLocalId: root.seedLocalId })).pendingProperties.map(
          (p) => p.propertyName,
        ),
      ).toEqual([])

      // The single relation: the seed uid, as sync writes it.
      const leadRow = await latestRow(root.seedLocalId, 'lead')
      expect(leadRow.uid).toMatch(/^0x[0-9a-f]{64}$/)
      expect(leadRow.versionUid).toBe(rootVersion)
      expect(leadRow.propertyValue).toBe(seedUids[lead.seedLocalId])

      // No other attested row of the root still names a member by local id.
      const rows = await db
        .select()
        .from(metadata)
        .where(and(eq(metadata.seedLocalId, root.seedLocalId)))
      for (const r of rows.filter((x: any) => x.uid && x.propertyName !== 'title')) {
        for (const m of [m1, m2, lead]) expect(String(r.propertyValue)).not.toContain(m.seedLocalId)
      }

      // A later publish attests the same seed uids (no local-id bytes).
      const again = (await getPublishPayload(root as any, [], { publishMode: 'new_version' })) as any[]
      expect(again.map((r) => r.localId)).toEqual([root.seedLocalId])
      const att = again[0].listOfAttestations.find((a: any) => a._propertyName === 'members')
      for (const uid of [seedUids[m1.seedLocalId]!, knownUid, seedUids[m2.seedLocalId]!]) {
        expect(att.data[0].data.toLowerCase()).toContain(uid.slice(2).toLowerCase())
      }
      expect(att._rawListIdsForResolve).toBeUndefined()
    }, 90000)
  }

  it('a slot with no uid leaves the value as it is (it is not what was attested)', async () => {
    const m1 = await createItem({ modelName: 'PubRecMember', label: 'unresolved m1' })
    const root = await createItem({ modelName: 'PubRecHolder', title: 'unresolved', members: [m1.seedLocalId] })
    const before = await latestRow(root.seedLocalId, LIST_STORAGE_NAME)
    const payload = (await getPublishPayload(root as any, [])) as any[]
    const req = payload.find((r) => r.localId === root.seedLocalId)
    const versionUid = nextUid()
    await updateVersionUid({ seedLocalId: root.seedLocalId, versionUid, publisher: PUBLISHER, attestationCreatedAt: Date.now() })
    const listAtt = req.listOfAttestations.find((a: any) => a._propertyName === 'members')
    const attUid = nextUid()
    await applyPropertyAttestationUidsFromPublish({
      seedLocalId: root.seedLocalId,
      attestationCreatedAtMs: Date.now(),
      versionUid,
      pairs: [{ schemaUid: listAtt.schema, attestationUid: attUid, propertyName: 'members' }],
    })
    const after = await latestRow(root.seedLocalId, LIST_STORAGE_NAME)
    expect(after.uid).toBe(attUid)
    expect(after.propertyValue).toBe(before.propertyValue)
  }, 90000)
})

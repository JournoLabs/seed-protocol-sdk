import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { Item } from '@/Item/Item'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { BaseArweaveClient } from '@/helpers/ArweaveClient/BaseArweaveClient'
import { getPublishPayload } from '@/db/read/getPublishPayload'
import { getPublishUploads } from '@/db/read/getPublishUploads'
import { RelatedItemUnpublishedError } from '@/db/read/publishErrors'
import { getUnpublishedRelatedItems, summarizePublishWork } from '@/db/read/summarizePublishWork'
import { getPublishDraftGraph } from '@/db/read/publishDraftGraph'
import { updateSeedRevokedAt } from '@/db/write/updateSeedRevokedAt'
import { BaseDb } from '@/db/Db/BaseDb'
import { seeds, versions } from '@/seedSchema'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../../test-utils/client-init'
import {
  ensureModelUidsForGetPublishPayloadTest,
  ensurePropertySchemaUidsForGetPublishPayloadTest,
  waitForPropertyInstances,
} from '../../test-utils/getPublishPayloadIntegrationHelpers'
import { waitForIdle } from '../../test-utils/waitForIdle'

/**
 * A publish carries along every draft item reachable from the published one through relation and
 * list properties, each with its full property set (relations and lists included), so no published
 * attestation is left pointing at a draft's local id. Uploads, the work summary and the revoked-ref
 * check walk the same graph.
 */
const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.sequential

const SCHEMA_NAME = 'Test Schema publishDraftGraph'

const schemaFile = () => ({
  $schema: 'https://seedprotocol.org/schemas/data-model/v1',
  version: 1,
  id: generateId(),
  metadata: { name: SCHEMA_NAME, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  models: {
    DraftGraphNode: {
      id: generateId(),
      properties: {
        label: { id: generateId(), type: 'Text' },
        next: { id: generateId(), type: 'Relation', model: 'DraftGraphNode' },
        body: { id: generateId(), type: 'Html' },
      },
    },
    DraftGraphRoot: {
      id: generateId(),
      properties: {
        title: { id: generateId(), type: 'Text' },
        first: { id: generateId(), type: 'Relation', model: 'DraftGraphNode' },
        nodes: { id: generateId(), type: 'List', refValueType: 'Relation', ref: 'DraftGraphNode' },
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
  return '0x' + ('9f7a1c' + tail).padEnd(64, 'c')
}

const createItem = async (props: Record<string, unknown>) => {
  const item = await Item.create({ schemaName: SCHEMA_NAME, ...props } as any)
  await waitForIdle(item, 'Item', 15000)
  await waitForPropertyInstances(item)
  return item
}

const node = (label: string, extra: Record<string, unknown> = {}) =>
  createItem({ modelName: 'DraftGraphNode', label, ...extra })

const setValue = async (item: Item<any>, propertyName: string, value: unknown) => {
  const prop = item.allProperties[propertyName]!
  prop.value = value
  await prop.save()
  await vi.waitFor(() => {
    const ctx = (prop.getService().getSnapshot() as any).context
    expect(ctx.propertyValue).toBe(value)
  })
}

/** Gives a draft a live published seed (as a publish would). */
const markPublished = async (item: Item<any>): Promise<string> => {
  const seedUid = nextUid()
  const db = BaseDb.getAppDb()
  await db.update(seeds).set({ uid: seedUid }).where(eq(seeds.localId, item.seedLocalId))
  await db
    .update(versions)
    .set({ uid: nextUid(), seedUid, attestationCreatedAt: Date.now() })
    .where(eq(versions.seedLocalId, item.seedLocalId))
  const fresh = await Item.find({ seedLocalId: item.seedLocalId })
  ;(fresh as any)?.getService?.().send({ type: 'updateContext', seedUid })
  return seedUid
}

const attestedNames = (payload: any[], localId: string) =>
  payload
    .find((p) => p.localId === localId)
    .listOfAttestations.map((a: any) => a._propertyName)
    .sort()

const linksOf = (payload: any[], localId: string) =>
  payload.find((p) => p.localId === localId).propertiesToUpdate.map((u: any) => u.publishLocalId)

const indexOf = (payload: any[], localId: string) => payload.findIndex((p) => p.localId === localId)

/** No attestation encodes the local id of a seed that this publish doesn't create. */
const expectNoDanglingLocalRefs = (payload: any[]) => {
  const inBatch = new Set(payload.map((p) => p.localId))
  for (const p of payload) {
    for (const a of p.listOfAttestations) {
      if (a._unresolvedValue) expect(inBatch.has(a._unresolvedValue)).toBe(true)
      for (const id of a._rawListIdsForResolve ?? []) {
        if (!String(id).startsWith('0x')) expect(inBatch.has(id)).toBe(true)
      }
    }
  }
}

const totalAttestations = (payload: any[]) =>
  payload.reduce((n, p) => n + p.listOfAttestations.length, 0)

testDescribe('publish carries the full graph of related drafts', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const schema = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(schema) }, schema.version)
    await ensureModelUidsForGetPublishPayloadTest(['DraftGraphRoot', 'DraftGraphNode', 'Image', 'File', 'Html'], SCHEMA_NAME)
    await ensurePropertySchemaUidsForGetPublishPayloadTest(schema as any)
    vi.spyOn(BaseArweaveClient, 'createTransaction').mockImplementation(async () => ({ id: 'unsigned', tags: [] }) as any)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    vi.restoreAllMocks()
    await teardownTestEnvironment()
  })

  it('root → draft A → draft B (relations): A and B are published with all their properties', async () => {
    const b = await node('B', { body: '<p>b body</p>' })
    const a = await node('A', { next: b.seedLocalId })
    const root = await createItem({ modelName: 'DraftGraphRoot', title: 'chain', first: a.seedLocalId })

    const payload = (await getPublishPayload(root as any, [])) as any[]
    expect(payload.map((p) => p.localId).sort()).toEqual(
      expect.arrayContaining([root.seedLocalId, a.seedLocalId, b.seedLocalId]),
    )
    expect(attestedNames(payload, a.seedLocalId)).toEqual(['label', 'next'])
    expect(attestedNames(payload, b.seedLocalId)).toEqual(['body', 'label'])
    expect(linksOf(payload, b.seedLocalId)).toEqual([a.seedLocalId])
    expect(linksOf(payload, a.seedLocalId)).toEqual([root.seedLocalId])
    expect(indexOf(payload, b.seedLocalId)).toBeLessThan(indexOf(payload, a.seedLocalId))
    expect(indexOf(payload, a.seedLocalId)).toBeLessThan(indexOf(payload, root.seedLocalId))
    expectNoDanglingLocalRefs(payload)

    // B's Html is uploaded with the root's publish.
    const bHtmlSeed = (b.allProperties.body!.getService().getSnapshot() as any).context.propertyValue
    const uploads = await getPublishUploads(root as any)
    expect(uploads.map((u) => u.seedLocalId)).toContain(bHtmlSeed)

    const summary = await summarizePublishWork(root as any)
    expect(summary.newSeedCount).toBe(3)
    expect(summary.attestationCount).toBe(totalAttestations(payload.filter((p) => p.localId !== bHtmlSeed)))
  }, 90000)

  it('root → list of drafts, each with a relation to another draft', async () => {
    const b1 = await node('B1')
    const b2 = await node('B2', { body: '<p>b2 body</p>' })
    const a1 = await node('A1', { next: b1.seedLocalId })
    const a2 = await node('A2', { next: b2.seedLocalId })
    const root = await createItem({ modelName: 'DraftGraphRoot', title: 'list', nodes: [a1.seedLocalId, a2.seedLocalId] })

    const payload = (await getPublishPayload(root as any, [])) as any[]
    for (const [a, b] of [[a1, b1], [a2, b2]] as const) {
      expect(attestedNames(payload, a.seedLocalId)).toEqual(['label', 'next'])
      expect(linksOf(payload, a.seedLocalId)).toEqual([root.seedLocalId])
      expect(linksOf(payload, b.seedLocalId)).toEqual([a.seedLocalId])
      expect(indexOf(payload, b.seedLocalId)).toBeLessThan(indexOf(payload, a.seedLocalId))
    }
    // Stable order: the walk is depth first, list members in order.
    expect(payload.map((p) => p.localId).filter((id) => [a1, b1, a2, b2, root].some((i) => i.seedLocalId === id))).toEqual(
      [b1, a1, b2, a2, root].map((i) => i.seedLocalId),
    )
    expectNoDanglingLocalRefs(payload)

    const b2HtmlSeed = (b2.allProperties.body!.getService().getSnapshot() as any).context.propertyValue
    const uploads = await getPublishUploads(root as any)
    expect(uploads.map((u) => u.seedLocalId)).toContain(b2HtmlSeed)

    const graph = await getPublishDraftGraph(root as any)
    expect(graph.drafts.map((d) => d.item.seedLocalId)).toEqual([b1, a1, b2, a2].map((i) => i.seedLocalId))
    expect((await summarizePublishWork(root as any)).newSeedCount).toBe(5)
  }, 90000)

  it('a cycle (A ↔ B) is walked once; the back reference is left for a later publish', async () => {
    const b = await node('cycle B')
    const a = await node('cycle A', { next: b.seedLocalId })
    await setValue(b, 'next', a.seedLocalId)
    const root = await createItem({ modelName: 'DraftGraphRoot', title: 'cycle', first: a.seedLocalId })

    const payload = (await getPublishPayload(root as any, [])) as any[]
    expect(payload.map((p) => p.localId)).toEqual([b.seedLocalId, a.seedLocalId, root.seedLocalId])
    expect(attestedNames(payload, a.seedLocalId)).toEqual(['label', 'next'])
    // B can't attest A's uid: A is published after B in this publish. B.next keeps no uid.
    expect(attestedNames(payload, b.seedLocalId)).toEqual(['label'])
    expect(linksOf(payload, b.seedLocalId)).toEqual([a.seedLocalId])
    expectNoDanglingLocalRefs(payload)

    const graph = await getPublishDraftGraph(root as any)
    expect(graph.drafts.map((d) => d.item.seedLocalId)).toEqual([b.seedLocalId, a.seedLocalId])
    expect([...graph.deferredProperties].map((p) => `${p.seedLocalId}:${p.propertyName}`)).toEqual([
      `${b.seedLocalId}:next`,
    ])
    await expect(getPublishUploads(root as any)).resolves.toBeDefined()
    const summary = await summarizePublishWork(root as any)
    expect(summary.newSeedCount).toBe(3)
    expect(summary.attestationCount).toBe(totalAttestations(payload))
  }, 90000)

  it('a draft referring back to the draft being published leaves that reference for later', async () => {
    const a = await node('back to root')
    const root = await createItem({ modelName: 'DraftGraphRoot', title: 'root cycle', first: a.seedLocalId })
    await setValue(a, 'next', root.seedLocalId)

    const payload = (await getPublishPayload(root as any, [])) as any[]
    expect(payload.map((p) => p.localId)).toEqual([a.seedLocalId, root.seedLocalId])
    expect(attestedNames(payload, a.seedLocalId)).toEqual(['label'])
    expectNoDanglingLocalRefs(payload)
  }, 90000)

  it('republishing an unpublished item: a draft referring back to it is deferred, not reported as unpublished', async () => {
    const a = await node('back to republished root')
    const root = await createItem({ modelName: 'DraftGraphRoot', title: 'republished root', first: a.seedLocalId })
    await setValue(a, 'next', root.seedLocalId)
    await markPublished(root)
    await updateSeedRevokedAt({ seedLocalId: root.seedLocalId, revokedAt: Math.floor(Date.now() / 1000) })

    const payload = (await getPublishPayload(root as any, [])) as any[]
    expect(payload.map((p) => p.localId)).toEqual([a.seedLocalId, root.seedLocalId])
    expect(payload.find((p) => p.localId === root.seedLocalId).seedUid).toMatch(/^0x0+$/)
    expect(attestedNames(payload, a.seedLocalId)).toEqual(['label'])
    expectNoDanglingLocalRefs(payload)

    expect(await getUnpublishedRelatedItems(root as any)).toEqual([])
    const summary = await summarizePublishWork(root as any)
    expect(summary.unpublishedRelatedItems).toEqual([])
    expect(summary.attestationCount).toBe(totalAttestations(payload))
  }, 90000)

  it('an already-published target deep in the graph is referenced by its uid, not re-published', async () => {
    const published = await node('published leaf')
    const publishedUid = await markPublished(published)
    const a = await node('points at published', { next: published.seedLocalId })
    const root = await createItem({ modelName: 'DraftGraphRoot', title: 'to published', first: a.seedLocalId })

    const payload = (await getPublishPayload(root as any, [])) as any[]
    expect(payload.map((p) => p.localId)).toEqual([a.seedLocalId, root.seedLocalId])
    const nextAtt = payload
      .find((p) => p.localId === a.seedLocalId)
      .listOfAttestations.find((att: any) => att._propertyName === 'next')
    expect(nextAtt.data[0].data.toLowerCase()).toContain(publishedUid.slice(2).toLowerCase())
    expect(nextAtt._unresolvedValue).toBeUndefined()
  }, 90000)

  it('a revoked target deep in the graph blocks the publish', async () => {
    const gone = await node('revoked leaf')
    const goneUid = await markPublished(gone)
    await updateSeedRevokedAt({ seedLocalId: gone.seedLocalId, revokedAt: Math.floor(Date.now() / 1000) })
    const b = await node('list holder')
    const a = await node('middle', { next: b.seedLocalId })
    const root = await createItem({ modelName: 'DraftGraphRoot', title: 'to revoked', first: a.seedLocalId })
    await setValue(b, 'next', gone.seedLocalId)

    const expected = [
      { propertyName: 'next', modelName: 'DraftGraphNode', seedLocalId: gone.seedLocalId, seedUid: goneUid },
    ]
    const error = await getPublishPayload(root as any, []).catch((e) => e)
    expect(error).toBeInstanceOf(RelatedItemUnpublishedError)
    expect(error.unpublishedRelatedItems).toEqual(expected)
    expect(await getUnpublishedRelatedItems(root as any)).toEqual(expected)
    expect((await summarizePublishWork(root as any)).unpublishedRelatedItems).toEqual(expected)
  }, 90000)
})

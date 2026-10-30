import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { MetadataType } from '@/seedSchema'
import {
  setupTestEnvironment,
  teardownTestEnvironment,
  SETUP_HOOK_TIMEOUT_MS,
} from '../../test-utils/client-init'

/**
 * A relation value below 2^32 is a reference slot the publisher's multiPublish never filled (its
 * placeholder, bytes32(sourceIndex + 1)), not a seed uid. Sync skips a relation holding one, keeps
 * a list's other members, and doesn't fetch it as a related seed.
 */
type FakeAttestation = {
  id: string
  schemaId: string
  refUID: string
  attester: string
  timeCreated: number
  revoked: boolean
  revocationTime: number
  decodedDataJson: string
  schema: { schemaNames: { name: string }[] }
}

const fakeEas = vi.hoisted(() => ({
  modelSchemas: [] as { id: string; schema: string }[],
  seeds: [] as FakeAttestation[],
  versions: [] as FakeAttestation[],
  properties: [] as FakeAttestation[],
}))

vi.mock('@/eas', async () => {
  const actual = await import('@seedprotocol/eas')
  return {
    ...actual,
    getModelSchemasFromEas: async () => fakeEas.modelSchemas,
    getSeedsFromSchemaUids: async ({ schemaUids }: { schemaUids: string[] }) =>
      fakeEas.seeds.filter((s) => schemaUids.includes(s.schemaId)),
    getItemVersionsFromEas: async ({ seedUids }: { seedUids: string[] }) =>
      fakeEas.versions.filter((v) => seedUids.includes(v.refUID)),
    getItemPropertiesFromEas: async ({ versionUids }: { versionUids: string[] }) =>
      fakeEas.properties.filter((p) => versionUids.includes(p.refUID)),
  }
})

vi.mock('@/events/files/download', () => ({
  downloadAllFilesBinaryRequestHandler: async () => {},
  downloadTransactionIdWithDedupe: async () => false,
  scheduleBulkFilesDownloadFromEasSync: () => {},
}))

const SCHEMA_NAME = 'sync-unfilled-references-test'
const attester = '0x1234567890123456789012345678901234567890'
const uid = (byte: string) => '0x' + byte.repeat(32)
const placeholder = (n: number) => '0x' + n.toString(16).padStart(64, '0')
// UIDs differ from the other sync test files: files run in one browser worker share its DB.
const POST_SCHEMA = uid('7a')
const post = uid('7b')
const postVersion = uid('7c')
const author = uid('7d')
const tags = uid('7e')
const person = uid('7f')

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.skip

testDescribe('runSyncFromEas: unfilled references', () => {
  const attestation = (
    id: string,
    refUID: string,
    schemaId: string,
    schemaName: string,
    timeCreated: number,
    decodedDataJson = '',
  ): FakeAttestation => ({
    id,
    schemaId,
    refUID,
    attester,
    timeCreated,
    revoked: false,
    revocationTime: 0,
    decodedDataJson,
    schema: { schemaNames: [{ name: schemaName }] },
  })
  const propertySchemaUid = (def: string) =>
    '0x' + [...def].map((c) => c.charCodeAt(0).toString(16)).join('').padEnd(64, 'e').slice(0, 64)
  // decodedDataJson as the EAS indexer writes it.
  const property = (id: string, name: string, type: string, value: unknown, timeCreated: number) =>
    attestation(
      id,
      postVersion,
      propertySchemaUid(`${type} ${name}`),
      name,
      timeCreated,
      JSON.stringify([{ name, type, signature: `${type} ${name}`, value: { name, type, value } }]),
    )

  /** Seed uids sync asked EAS for as related seeds. */
  const relatedRequests: string[][] = []

  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })

    const { importJsonSchema } = await import('@/imports/json')
    const schema = {
      name: SCHEMA_NAME,
      models: {
        UnfilledPerson: { properties: { name: { type: 'Text' } } },
        UnfilledPost: {
          properties: {
            author: { type: 'Relation', model: 'UnfilledPerson' },
            tags: { type: 'List', refValueType: 'Relation', ref: 'UnfilledPerson' },
          },
        },
      },
    }
    await importJsonSchema({ contents: JSON.stringify(schema) })

    const { Model } = await import('@/Model/Model')
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      const names = Model.findByModelType('unfilled_post')?.properties?.map((p) => p.name) ?? []
      if (['author', 'tags'].every((n) => names.includes(n))) break
      await new Promise((r) => setTimeout(r, 100))
    }

    const { BaseEasClient } = await import('@seedprotocol/eas')
    vi.spyOn(BaseEasClient, 'getEasClient').mockReturnValue({
      request: async (_query: unknown, variables: { where?: { id?: { in?: string[] } } }) => {
        relatedRequests.push(variables?.where?.id?.in ?? [])
        return { itemSeeds: [] }
      },
    } as any)

    fakeEas.modelSchemas = [{ id: POST_SCHEMA, schema: 'bytes32 unfilled_post' }]
    fakeEas.seeds = [attestation(post, uid('00'), POST_SCHEMA, 'unfilled_post', 8_000)]
    fakeEas.versions = [attestation(postVersion, post, uid('cf'), 'version', 8_001)]
    fakeEas.properties = [
      property(author, 'author', 'bytes32', placeholder(2), 8_002),
      property(tags, 'tag_unfilled_person_ids', 'bytes32[]', [person, placeholder(1)], 8_003),
    ]
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    vi.restoreAllMocks()
    await teardownTestEnvironment()
  })

  it('skips a relation holding one and keeps the rest of a list', async () => {
    const { runSyncFromEas } = await import('@/events/item/syncDbWithEas')
    const { BaseDb } = await import('@/db/Db/BaseDb')
    const { metadata } = await import('@/seedSchema')
    const { inArray } = await import('drizzle-orm')

    await runSyncFromEas({ addresses: [attester] })

    const rows: MetadataType[] = await BaseDb.getAppDb()
      .select()
      .from(metadata)
      .where(inArray(metadata.uid, [author, tags]))
    const byUid = new Map(rows.map((r) => [r.uid, r]))

    expect(byUid.has(author)).toBe(false)
    expect(JSON.parse(byUid.get(tags)!.propertyValue!)).toEqual([person])
    expect(relatedRequests.flat()).toContain(person)
    expect(relatedRequests.flat()).not.toContain(placeholder(1))
    expect(relatedRequests.flat()).not.toContain(placeholder(2))
  })
})

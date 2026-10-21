import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { MetadataType } from '@/seedSchema'
import {
  setupTestEnvironment,
  teardownTestEnvironment,
  SETUP_HOOK_TIMEOUT_MS,
} from '../../test-utils/client-init'

/**
 * ADR 0021: sync stores a removal (an attested `''` or zero bytes32) and a retraction (a property
 * attestation revoked while its seed is live) as a row with no value, and fetches no zero uid as a
 * related seed. A revoked seed keeps its last values.
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
  requestedSeedUids: [] as string[],
}))

vi.mock('@/eas', async () => {
  const actual = await import('@seedprotocol/eas')
  return {
    ...actual,
    getModelSchemasFromEas: async () => fakeEas.modelSchemas,
    getSeedsFromSchemaUids: async ({ schemaUids }: { schemaUids: string[] }) =>
      fakeEas.seeds.filter((s) => schemaUids.includes(s.schemaId)),
    getSeedsByUids: async ({ seedUids }: { seedUids: string[] }) => {
      fakeEas.requestedSeedUids.push(...seedUids)
      return fakeEas.seeds.filter((s) => seedUids.includes(s.id))
    },
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

const SCHEMA_NAME = 'sync-clears-test'
const attester = '0x1234567890123456789012345678901234567890'
const uid = (byte: string) => '0x' + byte.repeat(32)
const ZERO = uid('00')
// UIDs differ from the other sync test files: files run in one browser worker share its DB.
const NOTE_SCHEMA = uid('d5')
const note = uid('d6')
const noteVersion = uid('d7')
const titleBefore = uid('d8')
const titleRemoved = uid('d9')
const coverRemoved = uid('da')
const summaryRetracted = uid('db')
const revokedNote = uid('dc')
const revokedNoteVersion = uid('dd')
const revokedNoteSummary = uid('de')

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.skip

testDescribe('runSyncFromEas: removed and retracted properties (ADR 0021)', () => {
  const attestation = (
    id: string,
    refUID: string,
    schemaId: string,
    schemaName: string,
    timeCreated: number,
    decodedDataJson = '',
    revocationTime = 0,
  ): FakeAttestation => ({
    id,
    schemaId,
    refUID,
    attester,
    timeCreated,
    revoked: revocationTime > 0,
    revocationTime,
    decodedDataJson,
    schema: { schemaNames: [{ name: schemaName }] },
  })
  const propertySchemaUid = (def: string) =>
    '0x' + [...def].map((c) => c.charCodeAt(0).toString(16)).join('').padEnd(64, 'e').slice(0, 64)
  // decodedDataJson as the EAS indexer writes it.
  const property = (
    id: string,
    version: string,
    name: string,
    type: string,
    value: unknown,
    timeCreated: number,
    revocationTime = 0,
  ) =>
    attestation(
      id,
      version,
      propertySchemaUid(`${type} ${name}`),
      name,
      timeCreated,
      JSON.stringify([{ name, type, signature: `${type} ${name}`, value: { name, type, value } }]),
      revocationTime,
    )

  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })

    const { importJsonSchema } = await import('@/imports/json')
    const schema = {
      name: SCHEMA_NAME,
      models: {
        ClearNote: {
          properties: {
            title: { type: 'Text' },
            summary: { type: 'Text' },
            cover: { type: 'Image' },
          },
        },
      },
    }
    await importJsonSchema({ contents: JSON.stringify(schema) })

    const { Model } = await import('@/Model/Model')
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      const names = Model.findByModelType('clear_note')?.properties?.map((p) => p.name) ?? []
      if (['title', 'summary', 'cover'].every((n) => names.includes(n))) break
      await new Promise((r) => setTimeout(r, 100))
    }

    fakeEas.modelSchemas = [{ id: NOTE_SCHEMA, schema: 'bytes32 clear_note' }]
    fakeEas.seeds = [
      attestation(note, ZERO, NOTE_SCHEMA, 'clear_note', 8_000),
      attestation(revokedNote, ZERO, NOTE_SCHEMA, 'clear_note', 8_000, '', 8_100),
    ]
    fakeEas.versions = [
      attestation(noteVersion, note, uid('cf'), 'version', 8_001),
      attestation(revokedNoteVersion, revokedNote, uid('cf'), 'version', 8_001, '', 8_100),
    ]
    fakeEas.properties = [
      property(titleBefore, noteVersion, 'title', 'string', 'Hello', 8_002),
      property(titleRemoved, noteVersion, 'title', 'string', '', 8_010),
      property(coverRemoved, noteVersion, 'cover', 'bytes32', ZERO, 8_011),
      property(summaryRetracted, noteVersion, 'summary', 'string', 'Withdrawn', 8_003, 8_020),
      // An unpublished seed: everything revoked, the values stay
      property(revokedNoteSummary, revokedNoteVersion, 'summary', 'string', 'Last value', 8_003, 8_100),
    ]
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('stores removals and retractions with no value, and keeps a revoked seed’s values', async () => {
    const { runSyncFromEas } = await import('@/events/item/syncDbWithEas')
    const { BaseDb } = await import('@/db/Db/BaseDb')
    const { metadata } = await import('@/seedSchema')
    const { inArray } = await import('drizzle-orm')

    await runSyncFromEas({ addresses: [attester] })

    const rows: MetadataType[] = await BaseDb.getAppDb()
      .select()
      .from(metadata)
      .where(inArray(metadata.uid, [titleBefore, titleRemoved, coverRemoved, summaryRetracted, revokedNoteSummary]))
    const byUid = new Map(rows.map((r) => [r.uid, r]))

    expect(byUid.get(titleRemoved)).toMatchObject({ propertyName: 'title', propertyValue: null })
    // Only the version's newest title attestation is kept
    expect(byUid.has(titleBefore)).toBe(false)
    expect(byUid.get(coverRemoved)?.propertyValue).toBeNull()
    expect(byUid.get(summaryRetracted)).toMatchObject({ propertyName: 'summary', propertyValue: null })
    expect(byUid.get(summaryRetracted)?.revokedAt).toBe(8_020)
    expect(byUid.get(revokedNoteSummary)).toMatchObject({ propertyValue: 'Last value' })
    expect(fakeEas.requestedSeedUids).not.toContain(ZERO)
  })

  it('drops the value of a stored row whose attestation is revoked later, on a live seed', async () => {
    const { runSyncFromEas } = await import('@/events/item/syncDbWithEas')
    const { BaseDb } = await import('@/db/Db/BaseDb')
    const { metadata } = await import('@/seedSchema')
    const { eq } = await import('drizzle-orm')
    const titleLater = uid('df')
    fakeEas.properties.push(property(titleLater, noteVersion, 'title', 'string', 'Back again', 8_030))
    await runSyncFromEas({ addresses: [attester] })
    const [stored] = await BaseDb.getAppDb().select().from(metadata).where(eq(metadata.uid, titleLater))
    expect(stored?.propertyValue).toBe('Back again')

    // A retraction revokes every live title attestation on the version; the newest is kept
    fakeEas.properties = fakeEas.properties.map((p) =>
      [titleBefore, titleRemoved, titleLater].includes(p.id) ? { ...p, revoked: true, revocationTime: 8_040 } : p,
    )
    await runSyncFromEas({ addresses: [attester] })

    const [revoked] = await BaseDb.getAppDb().select().from(metadata).where(eq(metadata.uid, titleLater))
    expect(revoked).toMatchObject({ propertyValue: null, revokedAt: 8_040 })
  })
})

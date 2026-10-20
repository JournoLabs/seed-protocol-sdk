import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { MetadataType } from '@/seedSchema'
import {
  setupTestEnvironment,
  teardownTestEnvironment,
  SETUP_HOOK_TIMEOUT_MS,
} from '../../test-utils/client-init'

/**
 * ADR 0010 and ADR 0008's type rule: sync decodes numeric values as the indexer returns them
 * (`uint8` as a JSON number, `uint256` as `{ type: 'BigNumber', hex }`), stores a Number as its
 * decimal string and a Date as ISO, and skips attestations whose EAS type doesn't fit the local
 * property. The Date attestation is the one getPublishPayload builds for a local item.
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

const SCHEMA_NAME = 'sync-value-types-test'
const attester = '0x1234567890123456789012345678901234567890'
const uid = (byte: string) => '0x' + byte.repeat(32)
// UIDs differ from the other sync test files: files run in one browser worker share its DB.
const REPORT_SCHEMA = uid('5a')
const report = uid('5b')
const reportVersion = uid('5c')
const wordCount = uid('5d')
const rating = uid('5e')
const notANumber = uid('5f')
const titleAsBytes = uid('6a')
const publishedAt = uid('6b')
const delta = uid('6c')
const PUBLISHED_AT = '2026-10-15T08:30:00.000Z'

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.skip

testDescribe('runSyncFromEas: value types (ADR 0010)', () => {
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
      reportVersion,
      propertySchemaUid(`${type} ${name}`),
      name,
      timeCreated,
      JSON.stringify([{ name, type, signature: `${type} ${name}`, value: { name, type, value } }]),
    )

  /** What getPublishPayload attests for a local Date, as the indexer would return it. */
  const publishedDateValue = async (): Promise<{ type: 'BigNumber'; hex: string }> => {
    const { SchemaEncoder } = await import('@ethereum-attestation-service/eas-sdk')
    const { Item } = await import('@/Item/Item')
    const { waitForEntityIdle } = await import('@/helpers/waitForEntityIdle')
    const { WAIT_TIMEOUT_MS } = await import('../../test-utils/timeouts')
    const helpers = await import('../../test-utils/getPublishPayloadIntegrationHelpers')
    const created = await Item.create({ modelName: 'ValueReport', publishedAt: PUBLISHED_AT } as any)
    await waitForEntityIdle(created, { timeout: WAIT_TIMEOUT_MS })
    await helpers.waitForPropertyInstances(created)
    const payload: any[] = await created.getPublishPayload([])
    const att = payload.flatMap((p) => p.listOfAttestations ?? []).find((a: any) => a._propertyName === 'publishedAt')
    const [field] = new SchemaEncoder('uint256 published_at').decodeData(att.data[0].data)
    return { type: 'BigNumber', hex: '0x' + (field!.value.value as bigint).toString(16) }
  }

  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })

    const { importJsonSchema } = await import('@/imports/json')
    const schema = {
      name: SCHEMA_NAME,
      models: {
        ValueReport: {
          properties: {
            title: { type: 'Text' },
            wordCount: { type: 'Number' },
            rating: { type: 'Number' },
            pages: { type: 'Number' },
            delta: { type: 'Number' },
            publishedAt: { type: 'Date' },
          },
        },
      },
    }
    await importJsonSchema({ contents: JSON.stringify(schema) })

    const { Model } = await import('@/Model/Model')
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      const names = Model.findByModelType('value_report')?.properties?.map((p) => p.name) ?? []
      if (['title', 'wordCount', 'publishedAt'].every((n) => names.includes(n))) break
      await new Promise((r) => setTimeout(r, 100))
    }

    const helpers = await import('../../test-utils/getPublishPayloadIntegrationHelpers')
    await helpers.ensureModelUidsForGetPublishPayloadTest(['ValueReport'], SCHEMA_NAME)
    await helpers.ensurePropertySchemaUidsForGetPublishPayloadTest({
      models: { ValueReport: { properties: { publishedAt: { type: 'Date' } } } },
    } as any)

    fakeEas.modelSchemas = [{ id: REPORT_SCHEMA, schema: 'bytes32 value_report' }]
    fakeEas.seeds = [attestation(report, uid('00'), REPORT_SCHEMA, 'value_report', 7_000)]
    fakeEas.versions = [attestation(reportVersion, report, uid('cf'), 'version', 7_001)]
    fakeEas.properties = [
      // An older SDK's uint8 Number.
      property(wordCount, 'word_count', 'uint8', 7, 7_002),
      // This SDK's string Number.
      property(rating, 'rating', 'string', '4.5', 7_003),
      // A Text value from an app whose `pages` is Text, on the shared `string pages` schema.
      property(notANumber, 'pages', 'string', 'many', 7_004),
      // A type that doesn't fit Text.
      property(titleAsBytes, 'title', 'bytes32', uid('77'), 7_005),
      property(publishedAt, 'published_at', 'uint256', await publishedDateValue(), 7_006),
      // Another SDK's int256.
      property(delta, 'delta', 'int256', { type: 'BigNumber', hex: '-0x05' }, 7_007),
    ]
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('decodes numbers and dates, and skips attestations whose type does not fit', async () => {
    const { runSyncFromEas } = await import('@/events/item/syncDbWithEas')
    const { BaseDb } = await import('@/db/Db/BaseDb')
    const { metadata } = await import('@/seedSchema')
    const { inArray } = await import('drizzle-orm')

    await runSyncFromEas({ addresses: [attester] })

    const rows: MetadataType[] = await BaseDb.getAppDb()
      .select()
      .from(metadata)
      .where(inArray(metadata.uid, [wordCount, rating, notANumber, titleAsBytes, publishedAt, delta]))
    const byUid = new Map(rows.map((r) => [r.uid, r]))

    expect(byUid.get(wordCount)).toMatchObject({ propertyName: 'wordCount', propertyValue: '7' })
    expect(byUid.get(rating)).toMatchObject({ propertyName: 'rating', propertyValue: '4.5' })
    expect(byUid.get(delta)).toMatchObject({ propertyName: 'delta', propertyValue: '-5' })
    expect(byUid.get(publishedAt)).toMatchObject({ propertyName: 'publishedAt', propertyValue: PUBLISHED_AT })
    expect(byUid.has(notANumber)).toBe(false)
    expect(byUid.has(titleAsBytes)).toBe(false)
  })
})

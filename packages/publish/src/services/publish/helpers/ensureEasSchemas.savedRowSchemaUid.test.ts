import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { SchemaRegistry } from '@ethereum-attestation-service/eas-sdk'
import { BaseEasClient } from '@seedprotocol/eas'
import {
  BaseDb,
  Item,
  applyPropertyAttestationUidsFromPublish,
  generateId,
  importJsonSchema,
  metadata,
  seeds,
  versions,
} from '@seedprotocol/sdk'
import { getPendingRetractions } from '../../../../../sdk/src/db/read/getPropertyClear'
import { getPublishPayload } from '../../../../../sdk/src/db/read/getPublishPayload'
import {
  setupTestEnvironment,
  teardownTestEnvironment,
  SETUP_HOOK_TIMEOUT_MS,
} from '../../../../../sdk/__tests__/test-utils/client-init'
import {
  randomUid,
  waitForPropertyInstances,
  UNPUBLISH_TEST_PUBLISHER,
} from '../../../../../sdk/__tests__/test-utils/getPublishPayloadIntegrationHelpers'
import { brandTxSender } from '~/helpers/seedSigner'
import { setConfigRef, type PublishConfig } from '~/config'

/**
 * A property first given a value after a publish registered its schema records that schema's uid
 * on its row, so a later retraction (ADR 0021) can revoke the row's attestation. The EAS indexer
 * lags behind a new registration (it answers nothing here); only the chain and the indexer are
 * stubbed.
 */

const RESOLVER = '0x0000000000000000000000000000000000000000' as const
const schemaUidOf = (definition: string) => SchemaRegistry.getSchemaUID(definition, RESOLVER, true).toLowerCase()

/** Schemas on the stub chain: the Seed base schemas, then whatever the publish registers. */
const onChain = new Set([schemaUidOf('bytes32 schemaId,string name'), schemaUidOf('bytes32 version')])

vi.mock('~/helpers/schemaRegistry', async (importOriginal) => {
  const real = await importOriginal<typeof import('~/helpers/schemaRegistry')>()
  return {
    ...real,
    getSchemaRecord: async (uid: string) =>
      onChain.has(uid.toLowerCase()) ? { uid, resolver: RESOLVER, revocable: true, schema: '' } : null,
    registerSchema: (params: { schema: string }) => ({ to: RESOLVER, data: '0x', schema: params.schema }),
  }
})
vi.mock('~/helpers/chainClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/helpers/chainClient')>()),
  waitForPublishReceipt: async () => ({ status: 'success' as const }),
}))

const txSender = brandTxSender({
  address: UNPUBLISH_TEST_PUBLISHER as `0x${string}`,
  sendTransaction: async (tx: { schema?: string }) => {
    if (tx.schema) onChain.add(schemaUidOf(tx.schema))
    return { transactionHash: `0x${'ab'.repeat(32)}` as `0x${string}` }
  },
})

const SCHEMA_NAME = 'Test Schema savedRowSchemaUid'
// A property name no other test registers, so its schema is unknown until this publish.
const PROPERTY = `standfirst${generateId().toLowerCase().replace(/[^a-z]/g, '')}`
const DEFINITION = `string ${PROPERTY}`

/**
 * Records a publish of the item the way the publish package does after its receipts: the seed and
 * version get uids, and each attested metadata row its attestation uid.
 */
async function recordPublish(item: Awaited<ReturnType<typeof Item.create>>) {
  const db = BaseDb.getAppDb()
  const payload = (await getPublishPayload(item as never, [], { publishMode: 'patch' })).find(
    (p) => p.localId === item.seedLocalId,
  )!
  const seedUid = item.seedUid ?? randomUid()
  const versionUid = randomUid()
  await db.update(seeds).set({ uid: seedUid, publisher: UNPUBLISH_TEST_PUBLISHER }).where(eq(seeds.localId, item.seedLocalId!))
  await db.update(versions).set({ uid: versionUid, seedUid }).where(eq(versions.seedLocalId, item.seedLocalId!))
  await applyPropertyAttestationUidsFromPublish({
    seedLocalId: item.seedLocalId!,
    attestationCreatedAtMs: Date.now() - 1_000,
    versionUid,
    pairs: payload.listOfAttestations.map((a: any) => ({
      schemaUid: a.schema,
      attestationUid: randomUid(),
      propertyName: a._propertyName,
      metadataLocalId: a._metadataLocalId,
    })),
  })
  item.getService().send({ type: 'updateContext', seedUid, latestVersionUid: versionUid })
}

describe.sequential('a property saved after publish registered its schema', () => {
  const restoreEas: Array<() => void> = []

  beforeAll(async () => {
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: SETUP_HOOK_TIMEOUT_MS,
      configOverrides: { addresses: [UNPUBLISH_TEST_PUBLISHER] },
    })
    // The indexer hasn't seen the registration yet: every schema query finds nothing.
    const spy = vi
      .spyOn(BaseEasClient, 'getEasClient')
      .mockReturnValue({ request: async () => ({ schemas: [] }) } as never)
    restoreEas.push(() => spy.mockRestore())
    // Default chain (Optimism Sepolia) for the EAS and SchemaRegistry addresses.
    setConfigRef({} as PublishConfig)
    restoreEas.push(() => setConfigRef(null))
    const schema = {
      $schema: 'https://seedprotocol.org/schemas/data-model/v1',
      version: 1,
      id: generateId(),
      metadata: { name: SCHEMA_NAME, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      models: {
        Brief: {
          id: generateId(),
          properties: { label: { id: generateId(), type: 'Text' }, [PROPERTY]: { id: generateId(), type: 'Text' } },
        },
      },
      enums: {},
      migrations: [],
    }
    await importJsonSchema({ contents: JSON.stringify(schema) }, schema.version)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    restoreEas.forEach((restore) => restore())
    await teardownTestEnvironment()
  })

  it('records the registered schema uid on the new row, and retracts it', async () => {
    const { ensureEasSchemasForItem } = await import('./ensureEasSchemas')
    // PROPERTY has no value, so no row, when the item is published: its schema is registered anyway.
    const item = await Item.create({ schemaName: SCHEMA_NAME, modelName: 'Brief', label: 'first' } as any)
    await waitForPropertyInstances(item as any)

    await ensureEasSchemasForItem(item as never, txSender)
    expect(onChain.has(schemaUidOf(DEFINITION))).toBe(true)
    await recordPublish(item)

    const property = item.allProperties[PROPERTY]!
    property.value = 'after publish'
    await property.save()
    const [saved] = await BaseDb.getAppDb()
      .select()
      .from(metadata)
      .where(eq(metadata.localId, property.localId!))
    expect(saved?.propertyValue).toBe('after publish')
    expect(saved?.schemaUid?.toLowerCase()).toBe(schemaUidOf(DEFINITION))

    await recordPublish(item)
    const [attested] = await BaseDb.getAppDb()
      .select()
      .from(metadata)
      .where(eq(metadata.localId, saved!.localId!))
    expect(attested?.uid).toBeTruthy()

    await property.clear({ retract: true })

    const retractions = await getPendingRetractions({ seedLocalId: item.seedLocalId, seedUid: item.seedUid })
    const revoked = retractions.find((r) => r.propertyName === PROPERTY)?.attestations ?? []
    expect(revoked.map((a) => a.uid)).toContain(attested!.uid)
    expect(revoked.find((a) => a.uid === attested!.uid)?.schemaUid.toLowerCase()).toBe(schemaUidOf(DEFINITION))
  }, 60_000)
})

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { SchemaRegistry } from '@ethereum-attestation-service/eas-sdk'
import { BaseEasClient, easName } from '@seedprotocol/eas'
import { Item, generateId, importJsonSchema } from '@seedprotocol/sdk'
import {
  setupTestEnvironment,
  teardownTestEnvironment,
  SETUP_HOOK_TIMEOUT_MS,
} from '../../../../../sdk/__tests__/test-utils/client-init'
import { waitForPropertyInstances } from '../../../../../sdk/__tests__/test-utils/getPublishPayloadIntegrationHelpers'
import { brandSigner, brandTxSender, type PublishWallet } from '~/helpers/seedSigner'
import { setConfigRef, type PublishConfig } from '~/config'

/**
 * An automation session key can't register schemas, so ensureEasSchemasForItem fails when a schema
 * the publish attests under is missing. A property with no value attests nothing, so its schema is
 * not one of them (PermaPress: an Image draft with no alt text failed on `string alt`). The chain
 * and the EAS indexer are stubbed; the publish graph is read from real rows.
 */

const RESOLVER = '0x0000000000000000000000000000000000000000' as const
const MANAGED = '0x1111111111111111111111111111111111111111' as const
const SESSION = '0x2222222222222222222222222222222222222222' as const
const schemaUidOf = (definition: string) => SchemaRegistry.getSchemaUID(definition, RESOLVER, true).toLowerCase()

const onChain = new Set([schemaUidOf('bytes32 schemaId,string name'), schemaUidOf('bytes32 version')])
const sent: unknown[] = []

vi.mock('~/helpers/schemaRegistry', async (importOriginal) => {
  const real = await importOriginal<typeof import('~/helpers/schemaRegistry')>()
  return {
    ...real,
    getSchemaRecord: async (uid: string) =>
      onChain.has(uid.toLowerCase()) ? { uid, resolver: RESOLVER, revocable: true, schema: '' } : null,
  }
})
vi.mock('~/helpers/ensureAutomationSessionKey', () => ({
  isAutomationSessionActive: async () => true,
}))

const automationWallet: PublishWallet = {
  signer: brandSigner({ address: SESSION, signMessage: async () => '0x' as `0x${string}` }),
  txSender: brandTxSender({
    address: SESSION,
    sendTransaction: async (tx: unknown) => {
      sent.push(tx)
      return { transactionHash: `0x${'ab'.repeat(32)}` as `0x${string}` }
    },
  }),
}

const SCHEMA_NAME = 'Test Schema ensureEasSchemas attestedOnly'
// Names no other test registers
const suffix = generateId().toLowerCase().replace(/[^a-z]/g, '')
const BRIEF = `Brief${suffix}`
const PERSON = `Person${suffix}`
const LABEL = `label${suffix}`
const NOTE = `note${suffix}`
const AUTHOR = `author${suffix}`
const NAME = `name${suffix}`
const BIO = `bio${suffix}`

describe.sequential('ensureEasSchemasForItem with an automation session key', () => {
  const restore: Array<() => void> = []

  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const spy = vi
      .spyOn(BaseEasClient, 'getEasClient')
      .mockReturnValue({ request: async () => ({ schemas: [] }) } as never)
    restore.push(() => spy.mockRestore())
    setConfigRef({} as PublishConfig)
    restore.push(() => setConfigRef(null))
    const schema = {
      $schema: 'https://seedprotocol.org/schemas/data-model/v1',
      version: 1,
      id: generateId(),
      metadata: { name: SCHEMA_NAME, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      models: {
        [PERSON]: {
          id: generateId(),
          properties: { [NAME]: { id: generateId(), type: 'Text' }, [BIO]: { id: generateId(), type: 'Text' } },
        },
        [BRIEF]: {
          id: generateId(),
          properties: {
            [LABEL]: { id: generateId(), type: 'Text' },
            [NOTE]: { id: generateId(), type: 'Text' },
            [AUTHOR]: { id: generateId(), type: 'Relation', model: PERSON },
          },
        },
      },
      enums: {},
      migrations: [],
    }
    await importJsonSchema({ contents: JSON.stringify(schema) }, schema.version)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    restore.forEach((r) => r())
    await teardownTestEnvironment()
  })

  it('needs no schema for an empty property of the item or of a draft it publishes', async () => {
    const { ensureEasSchemasForItem } = await import('./ensureEasSchemas')
    for (const definition of [
      `bytes32 ${easName(BRIEF)}`,
      `bytes32 ${easName(PERSON)}`,
      `string ${easName(LABEL)}`,
      `string ${easName(NAME)}`,
      `bytes32 ${easName(AUTHOR)}`,
    ]) {
      onChain.add(schemaUidOf(definition))
    }
    const person = await Item.create({ schemaName: SCHEMA_NAME, modelName: PERSON, [NAME]: 'Ada' } as any)
    await waitForPropertyInstances(person as any)
    const brief = await Item.create({
      schemaName: SCHEMA_NAME,
      modelName: BRIEF,
      [LABEL]: 'first',
      [AUTHOR]: person.seedLocalId,
    } as any)
    await waitForPropertyInstances(brief as any)

    // NOTE and BIO have no value; their schemas aren't on chain
    await ensureEasSchemasForItem(brief as never, automationWallet, { managedAddress: MANAGED })
    expect(sent).toEqual([])
  }, 60_000)

  it('still fails before sending when a property with a value has no schema', async () => {
    const { ensureEasSchemasForItem } = await import('./ensureEasSchemas')
    const brief = await Item.create({
      schemaName: SCHEMA_NAME,
      modelName: BRIEF,
      [LABEL]: 'second',
      [NOTE]: 'has a value',
    } as any)
    await waitForPropertyInstances(brief as any)

    await expect(
      ensureEasSchemasForItem(brief as never, automationWallet, { managedAddress: MANAGED }),
    ).rejects.toThrow(`schema "string ${easName(NOTE)}" is not registered`)
    expect(sent).toEqual([])
  }, 60_000)
})

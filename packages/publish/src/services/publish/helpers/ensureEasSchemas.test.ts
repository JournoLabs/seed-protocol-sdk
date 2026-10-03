import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { SchemaRegistry } from '@ethereum-attestation-service/eas-sdk'
import { brandSigner, brandTxSender, type PublishWallet } from '../../../helpers/seedSigner'

const INTERNAL_DATA_TYPES = {
  Text: { eas: 'string' },
  Html: { eas: 'bytes32' },
  Image: { eas: 'bytes32' },
  File: { eas: 'bytes32' },
}

function normalizeDataType(value: string | undefined): string {
  if (!value) return value ?? ''
  const lower = value.toLowerCase().trim()
  const mapped: Record<string, string> = {
    text: 'Text',
    string: 'Text',
    html: 'Html',
    image: 'Image',
    file: 'File',
  }
  return mapped[lower] ?? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase()
}

const RESOLVER = '0x0000000000000000000000000000000000000000' as `0x${string}`
const MANAGED = '0x1111111111111111111111111111111111111111' as `0x${string}`
const SESSION = '0x2222222222222222222222222222222222222222' as `0x${string}`

function schemaUid(schema: string): string {
  return SchemaRegistry.getSchemaUID(schema, RESOLVER, true).toLowerCase()
}

const NAME_SCHEMA_DEF = 'bytes32 schemaId,string name'
const VERSION_SCHEMA_DEF = 'bytes32 version'
const BASE_SCHEMA_UIDS = [schemaUid(NAME_SCHEMA_DEF), schemaUid(VERSION_SCHEMA_DEF)]

const harness = {
  automationActive: false,
  knownUids: new Set<string>(),
  imageProperties: [] as Array<{
    propertyName: string
    propertyDef: { dataType: string }
  }>,
  basicProperties: [] as Array<{
    propertyName: string
    propertyDef: { dataType: string }
  }>,
}

const sendTransaction = mock(async () => ({
  transactionHash: `0x${'ab'.repeat(32)}` as `0x${string}`,
}))
const getSchemaRecord = mock(async (uid: string) => {
  if (!harness.knownUids.has(String(uid).toLowerCase())) return null
  return {
    uid,
    resolver: RESOLVER,
    revocable: true,
    schema: 'on-chain',
  }
})
const registerSchema = mock(() => ({
  to: '0x4200000000000000000000000000000000000020' as `0x${string}`,
  data: '0xregister' as `0x${string}`,
}))

function segmented() {
  return {
    itemBasicProperties: harness.basicProperties,
    itemRelationProperties: [],
    itemListProperties: [],
    itemImageProperties: harness.imageProperties,
  }
}

mock.module('@seedprotocol/sdk', () => ({
  INTERNAL_DATA_TYPES,
  ModelPropertyDataTypes: { File: 'File', Html: 'Html', Image: 'Image', Text: 'Text' },
  normalizeDataType,
  getSegmentedItemProperties: async () => segmented(),
  getRelatedItemsForPublish: async () => [],
  getEasSchemaForItemProperty: async () => null,
  setSchemaUidForSchemaDefinition: () => {},
  setSchemaUidForModel: () => {},
}))

mock.module('~/helpers/schemaRegistry', () => ({
  getSchemaRecord: (uid: string) => getSchemaRecord(uid),
  registerSchema: (...args: unknown[]) => registerSchema(...args),
}))

mock.module('~/helpers/nameSchemaAttestation', () => ({
  prepareNameSchemaAttestation: () => ({
    to: '0x4200000000000000000000000000000000000021' as `0x${string}`,
    data: '0xname' as `0x${string}`,
  }),
}))

mock.module('~/helpers/chainClient', () => ({
  waitForPublishReceipt: async () => ({ status: 'success' as const }),
}))

mock.module('~/helpers/chainConfig', () => ({
  getPublishViemChain: () => ({ id: 11155420, name: 'OP Sepolia' }),
}))

mock.module('~/helpers/ensureAutomationSessionKey', () => ({
  isAutomationSessionActive: async () => harness.automationActive,
}))

const { ensureEasSchemasForItem, resetEnsuredBaseSchemas } = await import('./ensureEasSchemas')

beforeEach(() => {
  resetEnsuredBaseSchemas()
})

function wallet(): PublishWallet {
  return {
    signer: brandSigner({
      address: SESSION,
      signMessage: async () => '0x' as `0x${string}`,
    }),
    txSender: brandTxSender({
      address: SESSION,
      sendTransaction,
    }),
  }
}

function postItem() {
  return { modelName: 'Post', properties: [] }
}

describe('ensureEasSchemasForItem', () => {
  test('lowercase html resolves to bytes32 html and does not register when that schema exists', async () => {
    harness.automationActive = false
    harness.imageProperties = [{ propertyName: 'html', propertyDef: { dataType: 'html' } }]
    harness.basicProperties = []
    harness.knownUids = new Set([
      ...BASE_SCHEMA_UIDS,
      schemaUid('bytes32 post'),
      schemaUid('bytes32 html'),
      schemaUid('string storage_transaction_id'),
    ])
    sendTransaction.mockClear()
    getSchemaRecord.mockClear()
    registerSchema.mockClear()

    await ensureEasSchemasForItem(postItem() as never, wallet())

    const lookedUp = getSchemaRecord.mock.calls.map((call) => String(call[0]).toLowerCase())
    expect(lookedUp).toContain(schemaUid('bytes32 html'))
    expect(lookedUp).not.toContain(schemaUid('string html'))
    expect(sendTransaction).not.toHaveBeenCalled()
    expect(registerSchema).not.toHaveBeenCalled()
  })

  test('an active automation session key fails before sending when a schema is missing', async () => {
    harness.automationActive = true
    harness.imageProperties = []
    harness.basicProperties = [{ propertyName: 'title', propertyDef: { dataType: 'text' } }]
    harness.knownUids = new Set([...BASE_SCHEMA_UIDS, schemaUid('bytes32 post')])
    sendTransaction.mockClear()
    registerSchema.mockClear()

    await expect(
      ensureEasSchemasForItem(postItem() as never, wallet(), { managedAddress: MANAGED }),
    ).rejects.toThrow(
      'schema "string title" is not registered; automation keys can\'t register schemas. Call ensureEasSchemasForItem with the owner wallet first.',
    )
    expect(sendTransaction).not.toHaveBeenCalled()
    expect(registerSchema).not.toHaveBeenCalled()
  })

  test('an owner wallet still registers a missing schema', async () => {
    harness.automationActive = false
    harness.imageProperties = []
    harness.basicProperties = [{ propertyName: 'title', propertyDef: { dataType: 'text' } }]
    harness.knownUids = new Set([...BASE_SCHEMA_UIDS, schemaUid('bytes32 post')])
    sendTransaction.mockClear()
    registerSchema.mockClear()

    await ensureEasSchemasForItem(postItem() as never, wallet(), { managedAddress: MANAGED })

    expect(registerSchema).toHaveBeenCalled()
    expect(sendTransaction).toHaveBeenCalled()
  })

  test('fails without sending when a base schema is missing, and does not register it', async () => {
    harness.automationActive = false
    harness.imageProperties = []
    harness.basicProperties = []
    harness.knownUids = new Set([schemaUid(NAME_SCHEMA_DEF), schemaUid('bytes32 post')])
    sendTransaction.mockClear()
    registerSchema.mockClear()

    await expect(ensureEasSchemasForItem(postItem() as never, wallet())).rejects.toThrow(
      `"${VERSION_SCHEMA_DEF}" (${schemaUid(VERSION_SCHEMA_DEF)}) not registered on chain 11155420`,
    )
    expect(registerSchema).not.toHaveBeenCalled()
    expect(sendTransaction).not.toHaveBeenCalled()
  })

  test('checks the base schemas once per chain', async () => {
    harness.automationActive = false
    harness.imageProperties = []
    harness.basicProperties = []
    harness.knownUids = new Set([...BASE_SCHEMA_UIDS, schemaUid('bytes32 post')])

    await ensureEasSchemasForItem(postItem() as never, wallet())
    getSchemaRecord.mockClear()
    await ensureEasSchemasForItem(postItem() as never, wallet())
    const lookedUp = getSchemaRecord.mock.calls.map((call) => String(call[0]).toLowerCase())
    expect(lookedUp).not.toContain(BASE_SCHEMA_UIDS[0])
    expect(lookedUp).not.toContain(BASE_SCHEMA_UIDS[1])
  })
})

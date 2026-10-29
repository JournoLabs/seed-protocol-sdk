import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { SchemaRegistry } from '@ethereum-attestation-service/eas-sdk'
import { BaseEasClient } from '@seedprotocol/eas'
import { AmbiguousModelError, generateId, importJsonSchema } from '@seedprotocol/sdk'
import {
  setupTestEnvironment,
  teardownTestEnvironment,
  SETUP_HOOK_TIMEOUT_MS,
} from '../../../../../sdk/__tests__/test-utils/client-init'
import { brandSigner, brandTxSender, type PublishWallet } from '~/helpers/seedSigner'
import { setConfigRef, type PublishConfig } from '~/config'
import { EasSchemasNotRegisteredError } from '~/errors'

/**
 * ensureEasSchemasForModels registers what a publish of a model can attest, from the loaded model
 * definitions, with no item. The chain and the EAS indexer are stubbed.
 */

const RESOLVER = '0x0000000000000000000000000000000000000000' as const
const MANAGED = '0x1111111111111111111111111111111111111111' as const
const OWNER = '0x2222222222222222222222222222222222222222' as const
const schemaUidOf = (definition: string) => SchemaRegistry.getSchemaUID(definition, RESOLVER, true).toLowerCase()

const BASE_SCHEMAS = [schemaUidOf('bytes32 schemaId,string name'), schemaUidOf('bytes32 version')]
const onChain = new Set(BASE_SCHEMAS)
const registered: string[] = []
const automation = { active: false }

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
vi.mock('~/helpers/ensureAutomationSessionKey', () => ({
  isAutomationSessionActive: async () => automation.active,
}))

const sendTransaction = vi.fn(async (tx: { schema?: string }) => {
  if (tx.schema) {
    onChain.add(schemaUidOf(tx.schema))
    registered.push(tx.schema)
  }
  return { transactionHash: `0x${'ab'.repeat(32)}` as `0x${string}` }
})
const wallet: PublishWallet = {
  signer: brandSigner({ address: OWNER, signMessage: async () => '0x' as `0x${string}` }),
  txSender: brandTxSender({ address: OWNER, sendTransaction: sendTransaction as never }),
}

const SCHEMA_NAME = 'Test Schema ensureEasSchemasForModels'
const OTHER_SCHEMA_NAME = 'Test Schema ensureEasSchemasForModels other'

function schemaFile(name: string, models: Record<string, Record<string, object>>) {
  return {
    $schema: 'https://seedprotocol.io/schemas/data-model/v1',
    version: 1,
    id: generateId(),
    metadata: { name, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    models: Object.fromEntries(
      Object.entries(models).map(([model, properties]) => [
        model,
        {
          id: generateId(),
          properties: Object.fromEntries(Object.entries(properties).map(([p, def]) => [p, { id: generateId(), ...def }])),
        },
      ]),
    ),
    enums: {},
    migrations: [],
  }
}

/** Definitions the Article model and the models it reaches attest under (Image's own are checked separately). */
const ARTICLE = ['bytes32 article', 'string title', 'bytes32 cover', 'bytes32[] author_contributor_ids', 'bytes32 editor']
const CONTRIBUTOR = ['bytes32 contributor', 'string name', 'bytes32 home']
const PLACE = ['bytes32 place', 'string label']
const IMAGE = ['bytes32 image', 'string alt', 'string storage_transaction_id']

describe.sequential('ensureEasSchemasForModels', () => {
  const restore: Array<() => void> = []
  let ensureEasSchemasForModels: typeof import('./ensureEasSchemas').ensureEasSchemasForModels

  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const spy = vi
      .spyOn(BaseEasClient, 'getEasClient')
      .mockReturnValue({ request: async () => ({ schemas: [] }) } as never)
    restore.push(() => spy.mockRestore())
    setConfigRef({} as PublishConfig)
    restore.push(() => setConfigRef(null))
    for (const file of [
      schemaFile(SCHEMA_NAME, {
        Place: { label: { type: 'Text' } },
        Contributor: { name: { type: 'Text' }, home: { type: 'Relation', model: 'Place' } },
        Article: {
          title: { type: 'Text' },
          cover: { type: 'Image' },
          authors: { type: 'List', items: { type: 'Relation', model: 'Contributor' } },
          editor: { type: 'Relation', model: 'Contributor' },
        },
      }),
      // A second schema with a model of the same name
      schemaFile(OTHER_SCHEMA_NAME, { Contributor: { handle: { type: 'Text' } } }),
    ]) {
      await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
    }
    ;({ ensureEasSchemasForModels } = await import('./ensureEasSchemas'))
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    restore.forEach((r) => r())
    await teardownTestEnvironment()
  })

  beforeEach(() => {
    automation.active = false
    sendTransaction.mockClear()
    registered.length = 0
  })

  it('without followRefs, a dry run lists the model and the storage models it reaches, and sends nothing', async () => {
    const result = await ensureEasSchemasForModels(['Article'], wallet, {
      schemaName: SCHEMA_NAME,
      followRefs: false,
      dryRun: true,
    })

    expect(result.registered).toEqual([])
    expect(result.missing).toEqual(expect.arrayContaining([...ARTICLE, ...IMAGE]))
    expect(result.missing).not.toEqual(expect.arrayContaining(['bytes32 contributor']))
    expect(result.missing).not.toContain('string name')
    expect(sendTransaction).not.toHaveBeenCalled()
  })

  it('an automation key throws with every missing definition before sending', async () => {
    automation.active = true

    const error = await ensureEasSchemasForModels(['Article'], wallet, {
      schemaName: SCHEMA_NAME,
      managedAddress: MANAGED,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(EasSchemasNotRegisteredError)
    expect((error as EasSchemasNotRegisteredError).code).toBe('EAS_SCHEMAS_NOT_REGISTERED')
    expect((error as EasSchemasNotRegisteredError).missing).toEqual(
      expect.arrayContaining([...ARTICLE, ...CONTRIBUTOR, ...PLACE, ...IMAGE]),
    )
    expect(sendTransaction).not.toHaveBeenCalled()
  })

  it('the owner registers the model, the models its refs reach, and the storage models, each once', async () => {
    const result = await ensureEasSchemasForModels(['Article'], wallet, { schemaName: SCHEMA_NAME })

    expect(result.registered).toEqual(expect.arrayContaining([...ARTICLE, ...CONTRIBUTOR, ...PLACE, ...IMAGE]))
    expect(result.registered).toEqual(result.missing)
    expect(registered).toEqual(result.registered)
    expect(new Set(registered).size).toBe(registered.length)
    // Each registration is named (Schema #1)
    expect(sendTransaction).toHaveBeenCalledTimes(registered.length * 2)
    // The other schema's Contributor isn't reached
    expect(registered).not.toContain('string handle')
  })

  it('sends nothing when everything is registered', async () => {
    const result = await ensureEasSchemasForModels(['Article'], wallet, { schemaName: SCHEMA_NAME })

    expect(result).toEqual({ missing: [], registered: [] })
    expect(sendTransaction).not.toHaveBeenCalled()
  })

  it('a model name two schemas define needs schemaName', async () => {
    await expect(ensureEasSchemasForModels(['Contributor'], wallet, { dryRun: true })).rejects.toBeInstanceOf(
      AmbiguousModelError,
    )
    const result = await ensureEasSchemasForModels(['Contributor'], wallet, {
      schemaName: OTHER_SCHEMA_NAME,
      dryRun: true,
    })
    expect(result.missing).toEqual(['string handle'])
  })

  it('throws for a model the schema does not define', async () => {
    await expect(
      ensureEasSchemasForModels(['Nope'], wallet, { schemaName: SCHEMA_NAME, dryRun: true }),
    ).rejects.toThrow(`No model named Nope in schema ${SCHEMA_NAME}`)
  })
})

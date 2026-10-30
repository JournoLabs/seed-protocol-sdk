import { describe, expect, mock, test } from 'bun:test'
import { encodeAbiParameters, encodeEventTopics, zeroAddress } from 'viem'
import { easAbi } from '../../../helpers/abi/eas'

/**
 * createAttestations, one-transaction path: an Image published together with the Post that shows
 * it. Every request records its own seed uid, version uid and property uids, matched to its own
 * events, and the publishing item gets its own seed uid (not the first request's).
 */

// Real modules first (they import the real SDK and config), then the mocks spread over them.
const realSdk = await import('@seedprotocol/sdk')
const realConfig = await import('../../../config')
const realChainClient = await import('../../../helpers/chainClient')

const EAS = '0x00000000000000000000000000000000000000ea' as `0x${string}`
const PUBLISHER = '0x00000000000000000000000000000000000000cc' as `0x${string}`
const ZERO = `0x${'0'.repeat(64)}`
const h = (c: string) => `0x${c.repeat(64)}` as `0x${string}`

const SCHEMA_IMAGE_SEED = h('1')
const SCHEMA_POST_SEED = h('2')
const SCHEMA_VERSION = h('3')
const SCHEMA_IMAGE_SRC = h('4')
const SCHEMA_POST_TITLE = h('5')

const IMAGE_SEED = h('a')
const IMAGE_VERSION = h('b')
const IMAGE_SRC = h('c')
const POST_SEED = h('d')
const POST_VERSION = h('e')
const POST_TITLE = h('f')

const attested = (schemaUID: `0x${string}`, uid: `0x${string}`) => ({
  address: EAS,
  topics: encodeEventTopics({
    abi: easAbi,
    eventName: 'Attested',
    args: { recipient: zeroAddress, attester: PUBLISHER, schemaUID },
  }),
  data: encodeAbiParameters([{ type: 'bytes32' }], [uid]),
})

/** As SeedProtocolExtensionBase.multiPublish emits them for [Image, Post]. */
const RECEIPT = {
  logs: [
    attested(SCHEMA_IMAGE_SEED, IMAGE_SEED),
    attested(SCHEMA_VERSION, IMAGE_VERSION),
    attested(SCHEMA_POST_SEED, POST_SEED),
    attested(SCHEMA_VERSION, POST_VERSION),
    attested(SCHEMA_IMAGE_SRC, IMAGE_SRC),
    attested(SCHEMA_POST_TITLE, POST_TITLE),
  ],
}

const updateVersionUid = mock(async (_: unknown) => {})
const applyPropertyAttestationUidsFromPublish = mock(async (_: unknown) => {})
// The real one writes them in one transaction; here it hands each to its mock
const recordPublishRequests = mock(async (records: Array<{ version?: unknown; properties?: unknown }>) => {
  for (const { version, properties } of records) {
    if (version) await updateVersionUid(version)
    if (properties) await applyPropertyAttestationUidsFromPublish(properties)
  }
})
const sendTransaction = mock(async () => ({ transactionHash: '0x01' }))
const relatedImage = {
  seedLocalId: 'imageLocal2',
  seedUid: undefined as string | undefined,
  persistSeedUid: mock(async (_publisher?: string, _ms?: number) => {}),
}
/** The publishing item as Item.find loads it, for a publish restored with the item as plain data. */
let reloadedPost: Record<string, unknown> | undefined
const itemFind = mock(async (q: { seedLocalId?: string }) =>
  q.seedLocalId === relatedImage.seedLocalId
    ? relatedImage
    : q.seedLocalId === 'postLocal02'
      ? reloadedPost
      : undefined,
)

mock.module('@seedprotocol/sdk', () => ({
  ...realSdk,
  updateVersionUid,
  applyPropertyAttestationUidsFromPublish,
  recordPublishRequests,
  Item: { find: itemFind },
  clearHtmlEmbeddedImageCoPublishRows: async () => {},
}))
mock.module('../../../config', () => ({
  ...realConfig,
  getPublishConfig: () => ({ useModularExecutor: false, easContractAddress: EAS }),
}))
mock.module('../../../helpers/chainClient', () => ({
  ...realChainClient,
  isContractDeployed: async () => true,
  waitForPublishReceipt: async () => RECEIPT,
}))
mock.module('../helpers/receiptAttestationMs', () => ({
  attestationMsFromReceipt: async () => 1_700_000_000_000,
}))
const ensureEasSchemasForItem = mock(async () => {})
mock.module('../helpers/ensureEasSchemas', () => ({ ensureEasSchemasForItem }))
mock.module('../helpers/verifyArweaveTransactionsExist', () => ({
  verifyArweaveTransactionsExist: async () => {},
}))
mock.module('../../../helpers/ensureManagedAccountEasConfigured', () => ({
  ensureManagedAccountEasConfigured: async () => {},
  assertManagedAccountEasMatchesConfig: async () => {},
}))
mock.module('../../../helpers/executorModuleReadiness', () => ({
  simulateCallFromAccount: async () => {},
  assertExecutorModuleReadyForAccount: async () => {},
}))
mock.module('../../../helpers/resolvePublishWallet', () => ({
  resolvePublishWallet: () => ({
    txSender: { address: PUBLISHER, sendTransaction },
  }),
}))
mock.module('../../../helpers/multiPublishRoute', () => ({ assertMultiPublishRouted: async () => {} }))
mock.module('../../../helpers/publishGas', () => ({ publishGasLimit: async () => 1_234_567n }))
mock.module('../../arweaveL1Finalize/enqueue', () => ({
  enqueueArweaveL1FinalizeJobsFromPublishContext: async () => {},
}))

const { createAttestations } = await import('./createAttestations')
const { createActor, fromPromise, toPromise, waitFor } = await import('xstate')
const { publishMachine } = await import('../index')

const attestation = (schema: string, name: string) => ({
  schema,
  data: [
    {
      recipient: '0x0000000000000000000000000000000000000000',
      expirationTime: 0,
      revocable: true,
      refUID: ZERO,
      data: '0x1234',
      value: 0,
    },
  ],
  _propertyName: name,
})

const requests = () => [
  {
    localId: relatedImage.seedLocalId,
    seedUid: ZERO,
    seedSchemaUid: SCHEMA_IMAGE_SEED,
    versionUid: ZERO,
    versionSchemaUid: SCHEMA_VERSION,
    seedIsRevocable: true,
    listOfAttestations: [attestation(SCHEMA_IMAGE_SRC, 'storageTransactionId')],
    propertiesToUpdate: [],
  },
  {
    localId: 'postLocal02',
    seedUid: ZERO,
    seedSchemaUid: SCHEMA_POST_SEED,
    versionUid: ZERO,
    versionSchemaUid: SCHEMA_VERSION,
    seedIsRevocable: true,
    listOfAttestations: [attestation(SCHEMA_POST_TITLE, 'title')],
    propertiesToUpdate: [],
  },
]

describe('createAttestations: related items published in the same transaction', () => {
  test('every request records its own seed, version and property uids', async () => {
    const item = {
      seedLocalId: 'postLocal02',
      seedUid: undefined as string | undefined,
      getPublishUploads: async () => [],
      getPublishPayload: async () => requests(),
      persistSeedUid: mock(async (_publisher?: string, _ms?: number) => {}),
    }
    const actor = createActor(createAttestations, {
      input: {
        context: {
          address: PUBLISHER,
          account: {},
          item,
          arweaveTransactions: [],
          publishUploads: [],
          publishMode: 'patch',
        } as any,
        event: {},
      },
    })
    actor.start()
    const result = await toPromise(actor)

    // Versions: each item its own.
    const versions = Object.fromEntries(
      updateVersionUid.mock.calls.map(([a]) => [(a as any).seedLocalId, (a as any).versionUid]),
    )
    expect(versions).toEqual({ imageLocal2: IMAGE_VERSION, postLocal02: POST_VERSION })

    // Properties: each item's own uids, on its own version.
    const properties = Object.fromEntries(
      applyPropertyAttestationUidsFromPublish.mock.calls.map(([a]) => [
        (a as any).seedLocalId,
        { versionUid: (a as any).versionUid, uids: (a as any).pairs.map((p: any) => p.attestationUid) },
      ]),
    )
    expect(properties).toEqual({
      imageLocal2: { versionUid: IMAGE_VERSION, uids: [IMAGE_SRC] },
      postLocal02: { versionUid: POST_VERSION, uids: [POST_TITLE] },
    })

    // Seeds: the publishing item gets the Post seed; the related Image records its own.
    expect(item.seedUid).toBe(POST_SEED)
    expect(item.persistSeedUid).toHaveBeenCalledTimes(1)
    expect(relatedImage.seedUid).toBe(IMAGE_SEED)
    expect(relatedImage.persistSeedUid).toHaveBeenCalledTimes(1)
    expect(relatedImage.persistSeedUid.mock.calls[0]![0]).toBe(PUBLISHER)

    expect(result.publishedBatch?.seedUid?.toLowerCase()).toBe(POST_SEED)
  })

  // A restored publish carries the item as plain data; the actor loads it and releases that hold.
  const runRestored = async (getPublishPayload: () => Promise<unknown>) => {
    const unload = mock(() => {})
    reloadedPost = {
      seedLocalId: 'postLocal02',
      seedUid: undefined,
      getPublishUploads: async () => [],
      getPublishPayload,
      persistSeedUid: mock(async () => {}),
      unload,
    }
    const actor = createActor(createAttestations, {
      input: {
        context: {
          address: PUBLISHER,
          account: {},
          item: { seedLocalId: 'postLocal02' },
          arweaveTransactions: [],
          publishUploads: [],
          publishMode: 'patch',
        } as any,
        event: {},
      },
    })
    actor.start()
    const outcome = await toPromise(actor).then(
      () => 'done',
      () => 'failed',
    )
    reloadedPost = undefined
    return { outcome, unloads: unload.mock.calls.length }
  }

  test('releases the item it loaded when the publish succeeds', async () => {
    expect(await runRestored(async () => requests())).toEqual({ outcome: 'done', unloads: 1 })
  })

  test('releases the item it loaded when the publish fails', async () => {
    const result = await runRestored(async () => {
      throw new Error('payload failed')
    })
    expect(result).toEqual({ outcome: 'failed', unloads: 1 })
  })
})

describe('createAttestations: recording failed after the transaction landed', () => {
  const machine = publishMachine.provide({
    actors: { revokeRetractedProperties: fromPromise(async () => {}) },
  })
  const failedAttestation = () => {
    const item = {
      seedLocalId: 'postLocal02',
      seedUid: undefined as string | undefined,
      getPublishUploads: async () => [],
      getPublishPayload: async () => requests(),
      persistSeedUid: mock(async (_publisher?: string, _ms?: number) => {}),
    }
    const context = {
      address: PUBLISHER,
      item,
      arweaveTransactions: [],
      publishUploads: [],
      publishMode: 'patch',
    }
    const snapshot = machine.resolveState({ value: 'attestationFailureRecoverable', context: context as any })
    return { item, context, actor: createActor(machine, { snapshot }) }
  }
  const atRest = (value: string) => (s: { value: unknown }) => s.value === value

  test('a retry records from the receipt and sends nothing', async () => {
    const { item, actor } = failedAttestation()
    actor.start()
    sendTransaction.mockClear()
    recordPublishRequests.mockImplementationOnce(async () => {
      throw new Error('disk full')
    })

    actor.send({ type: 'retry' } as any)
    await waitFor(actor, (s) => (s.context as any).unrecordedAttestation !== undefined)
    expect(sendTransaction).toHaveBeenCalledTimes(1)

    actor.send({ type: 'retry' } as any)
    await waitFor(actor, atRest('success'))
    expect(sendTransaction).toHaveBeenCalledTimes(1)
    expect(item.seedUid).toBe(POST_SEED)
    expect(actor.getSnapshot().context.unrecordedAttestation).toBeUndefined()
  })

  test('survives a saved snapshot, and a second failed record keeps the transaction', async () => {
    const { actor } = failedAttestation()
    actor.start()
    sendTransaction.mockClear()
    recordPublishRequests.mockImplementationOnce(async () => {
      throw new Error('disk full')
    })
    actor.send({ type: 'retry' } as any)
    await waitFor(actor, (s) => (s.context as any).unrecordedAttestation !== undefined)

    const { unrecordedAttestation } = actor.getSnapshot().context
    expect(unrecordedAttestation?.transactionHash).toBe('0x01')

    recordPublishRequests.mockImplementationOnce(async () => {
      throw new Error('still full')
    })
    actor.send({ type: 'retry' } as any)
    await waitFor(actor, (s) => (s.context as any).error?.cause?.message === 'still full')
    expect(actor.getSnapshot().context.unrecordedAttestation).toEqual(unrecordedAttestation)
    expect(sendTransaction).toHaveBeenCalledTimes(1)
    actor.stop()

    // As savePublish writes it and restoreFromDb reads it back: bigints come back as strings.
    const saved = JSON.parse(
      JSON.stringify(unrecordedAttestation, (_key, v) => (typeof v === 'bigint' ? v.toString() : v)),
    )
    const { item, context } = failedAttestation()
    const restored = createActor(machine, {
      snapshot: machine.resolveState({
        value: 'attestationFailureRecoverable',
        context: { ...context, unrecordedAttestation: saved } as any,
      }),
    })
    restored.start()
    restored.send({ type: 'retry' } as any)
    await waitFor(restored, atRest('success'))
    expect(sendTransaction).toHaveBeenCalledTimes(1)
    expect(item.seedUid).toBe(POST_SEED)
  })
})

describe('createAttestations: EAS schemas', () => {
  test('does not look up EAS schemas again: the checking state already ensured them', async () => {
    ensureEasSchemasForItem.mockClear()
    const item = {
      seedLocalId: 'postLocal02',
      seedUid: undefined as string | undefined,
      getPublishUploads: async () => [],
      getPublishPayload: async () => requests(),
      persistSeedUid: mock(async (_publisher?: string, _ms?: number) => {}),
    }
    const actor = createActor(createAttestations, {
      input: {
        context: {
          address: PUBLISHER,
          account: {},
          item,
          arweaveTransactions: [],
          publishUploads: [],
          publishMode: 'patch',
        } as any,
        event: {},
      },
    })
    actor.start()
    await toPromise(actor)
    expect(ensureEasSchemasForItem).not.toHaveBeenCalled()
  })
})

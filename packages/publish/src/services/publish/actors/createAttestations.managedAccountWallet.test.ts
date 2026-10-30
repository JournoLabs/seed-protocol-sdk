import { describe, expect, mock, test } from 'bun:test'
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, zeroAddress } from 'viem'
import { easAbi } from '../../../helpers/abi/eas'
import { multiPublishAbi } from '../../../helpers/abi/publisher'

/**
 * createAttestations with `useModularExecutor` and a publish wallet that sends as the ManagedAccount
 * itself (createManagedAccountTxSender): it publishes through that wallet, with no Thirdweb in-app
 * wallet prep. A wallet that only administers the account still goes through that prep.
 */

const realSdk = await import('@seedprotocol/sdk')
const realConfig = await import('../../../config')
const realChainClient = await import('../../../helpers/chainClient')

const EAS = '0x00000000000000000000000000000000000000ea' as `0x${string}`
const MANAGED = '0x00000000000000000000000000000000000000cc' as `0x${string}`
const ADMIN = '0x00000000000000000000000000000000000000ad' as `0x${string}`
const ZERO = `0x${'0'.repeat(64)}`
const h = (c: string) => `0x${c.repeat(64)}` as `0x${string}`

const RECEIPT = {
  logs: [
    {
      address: EAS,
      topics: encodeEventTopics({
        abi: easAbi,
        eventName: 'Attested',
        args: { recipient: zeroAddress, attester: MANAGED, schemaUID: h('2') },
      }),
      data: encodeAbiParameters([{ type: 'bytes32' }], [h('d')]),
    },
  ],
}

mock.module('@seedprotocol/sdk', () => ({
  ...realSdk,
  recordPublishRequests: async () => {},
  Item: { find: async () => undefined },
  clearHtmlEmbeddedImageCoPublishRows: async () => {},
}))
mock.module('../../../config', () => ({
  ...realConfig,
  getPublishConfig: () => ({
    useModularExecutor: true,
    modularAccountModuleContract: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    easContractAddress: EAS,
  }),
}))
mock.module('../../../helpers/chainClient', () => ({
  ...realChainClient,
  isContractDeployed: async () => true,
  waitForPublishReceipt: async () => RECEIPT,
}))
mock.module('../helpers/receiptAttestationMs', () => ({ attestationMsFromReceipt: async () => 1_700_000_000_000 }))
mock.module('../helpers/ensureEasSchemas', () => ({ ensureEasSchemasForItem: async () => {} }))
mock.module('../helpers/verifyArweaveTransactionsExist', () => ({ verifyArweaveTransactionsExist: async () => {} }))
const easConfigured = mock(async (_address: string, _wallet: unknown) => {})
mock.module('../../../helpers/ensureManagedAccountEasConfigured', () => ({
  ensureManagedAccountEasConfigured: easConfigured,
  assertManagedAccountEasMatchesConfig: async () => {},
}))
mock.module('../../../helpers/executorModuleReadiness', () => ({
  simulateCallFromAccount: async () => {},
  assertExecutorModuleReadyForAccount: async () => {},
}))
mock.module('../../../helpers/multiPublishRoute', () => ({ assertMultiPublishRouted: async () => {} }))
mock.module('../../../helpers/publishGas', () => ({ publishGasLimit: async () => 1_234_567n }))
mock.module('../../../helpers/ensureAutomationSessionKey', () => ({ isAutomationSessionActive: async () => false }))
const prep = mock(async () => ({ ok: false, error: new Error('Thirdweb in-app wallet prep ran') }))
mock.module('../../../helpers/ensureManagedAccountReady', () => ({ runModularExecutorPublishPrep: prep }))
mock.module('../../arweaveL1Finalize/enqueue', () => ({ enqueueArweaveL1FinalizeJobsFromPublishContext: async () => {} }))

const sent: { from: string; to: string; data: `0x${string}` }[] = []
let wallet: unknown
const walletSendingFrom = (from: `0x${string}`) => ({
  kind: 'modular',
  signer: { address: ADMIN, signMessage: async () => '0x' },
  txSender: {
    address: from,
    sendTransaction: async (tx: { to: string; data: `0x${string}` }) => {
      sent.push({ from, ...tx })
      return { transactionHash: '0x01' }
    },
  },
})
mock.module('../../../helpers/resolvePublishWallet', () => ({ resolvePublishWallet: () => wallet }))

const { createAttestations } = await import('./createAttestations')
const { createActor, toPromise } = await import('xstate')

async function publish() {
  const item = {
    seedLocalId: 'postLocal02',
    seedUid: undefined as string | undefined,
    getPublishUploads: async () => [],
    getPublishPayload: async () => [
      {
        localId: 'postLocal02',
        seedUid: ZERO,
        seedSchemaUid: h('2'),
        versionUid: ZERO,
        versionSchemaUid: h('3'),
        seedIsRevocable: true,
        listOfAttestations: [],
        propertiesToUpdate: [],
      },
    ],
    persistSeedUid: async () => {},
  }
  const actor = createActor(createAttestations, {
    input: {
      context: { address: MANAGED, account: {}, item, arweaveTransactions: [], publishUploads: [], publishMode: 'patch' } as any,
      event: {},
    },
  })
  actor.start()
  return toPromise(actor)
}

describe('createAttestations with a wallet that sends as the ManagedAccount', () => {
  test('sends multiPublish to the account from that wallet, without the in-app wallet prep', async () => {
    sent.length = 0
    prep.mockClear()
    wallet = walletSendingFrom(MANAGED)
    await publish()
    expect(prep).not.toHaveBeenCalled()
    expect(easConfigured.mock.calls[0]?.[0]).toBe(MANAGED)
    expect(sent).toHaveLength(1)
    expect(sent[0]!.from).toBe(MANAGED)
    expect(sent[0]!.to).toBe(MANAGED)
    expect(decodeFunctionData({ abi: multiPublishAbi, data: sent[0]!.data }).functionName).toBe('multiPublish')
  })

  test('a wallet that only administers the account still goes through the in-app wallet prep', async () => {
    sent.length = 0
    prep.mockClear()
    wallet = walletSendingFrom(ADMIN)
    await expect(publish()).rejects.toThrow('Thirdweb in-app wallet prep ran')
    expect(prep).toHaveBeenCalled()
    expect(sent).toHaveLength(0)
  })
})

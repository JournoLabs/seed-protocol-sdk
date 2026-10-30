import { expect, mock, test } from 'bun:test'

/** Session keys are granted a native limit of 0, so a UserOp carrying value would fail validation. */

const ZERO = `0x${'0'.repeat(64)}`
const realConfig = await import('../../../config')
const realContracts = await import('../../../helpers/contracts')

const ACCOUNT = '0x00000000000000000000000000000000000000cc' as `0x${string}`
const SESSION_KEY = '0x00000000000000000000000000000000000000dd' as `0x${string}`
const EXECUTOR = '0x00000000000000000000000000000000000000ee' as `0x${string}`

const sendTransaction = mock(async () => ({ transactionHash: '0x01' }))

mock.module('../../../config', () => ({
  ...realConfig,
  getPublishConfig: () => ({
    useModularExecutor: true,
    modularAccountModuleContract: EXECUTOR,
    easContractAddress: '0x00000000000000000000000000000000000000ea',
  }),
}))
mock.module('../../../helpers/contracts', () => ({
  ...realContracts,
  readIsActiveSigner: async () => true,
  readPermissionsForSigner: async () => ({
    approvedTargets: [EXECUTOR],
    nativeTokenLimitPerTransaction: 0n,
    startTimestamp: 0n,
    endTimestamp: 0n,
  }),
}))
const realChainClient = await import('../../../helpers/chainClient')
mock.module('../../../helpers/chainClient', () => ({ ...realChainClient, isContractDeployed: async () => true }))
mock.module('../helpers/verifyArweaveTransactionsExist', () => ({
  verifyArweaveTransactionsExist: async () => {},
}))
mock.module('../../../helpers/executorModuleReadiness', () => ({
  simulateCallFromAccount: async () => {},
  assertExecutorModuleReadyForAccount: async () => {},
}))
mock.module('../../../helpers/resolvePublishWallet', () => ({
  resolvePublishWallet: () => ({
    signer: { address: SESSION_KEY },
    txSender: { address: ACCOUNT, sendTransaction },
  }),
}))

const { createAttestations } = await import('./createAttestations')
const { createActor, toPromise } = await import('xstate')

test('refuses an attestation that asks for value, before sending', async () => {
  const payload = {
    localId: 'postLocal001',
    seedUid: ZERO,
    seedSchemaUid: `0x${'1'.repeat(64)}`,
    versionUid: ZERO,
    versionSchemaUid: `0x${'2'.repeat(64)}`,
    seedIsRevocable: true,
    propertiesToUpdate: [],
    listOfAttestations: [
      {
        schema: `0x${'3'.repeat(64)}`,
        data: [{ recipient: ACCOUNT, expirationTime: 0n, revocable: true, refUID: ZERO, data: '0x01', value: 7n }],
      },
    ],
  }
  const item = {
    seedLocalId: 'postLocal001',
    getPublishUploads: async () => [],
    getPublishPayload: async () => [payload],
  }
  const actor = createActor(createAttestations, {
    input: {
      context: { address: ACCOUNT, account: {}, item, arweaveTransactions: [], publishUploads: [] } as any,
      event: {},
    },
  })
  actor.start()
  await expect(toPromise(actor)).rejects.toMatchObject({ code: 'AUTOMATION_PREFLIGHT_FAILED' })
  expect(sendTransaction).not.toHaveBeenCalled()
})

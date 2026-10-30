import { expect, mock, test } from 'bun:test'

/**
 * An automation publish with a session key granted for an executor the factory has replaced: the
 * key is still an active signer, and the simulation passes because it runs from the account. The
 * publish stops before anything is sent rather than failing validation at the bundler.
 */

const realConfig = await import('../../../config')
const realContracts = await import('../../../helpers/contracts')

const ACCOUNT = '0x00000000000000000000000000000000000000cc' as `0x${string}`
const SESSION_KEY = '0x00000000000000000000000000000000000000dd' as `0x${string}`
const EXECUTOR = '0x00000000000000000000000000000000000000ee' as `0x${string}`
const OLD_EXECUTOR = '0x00000000000000000000000000000000000000ef' as `0x${string}`

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
    approvedTargets: [OLD_EXECUTOR],
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

test('refuses a session key not approved for the current executor, before sending', async () => {
  const item = {
    seedLocalId: 'postLocal001',
    getPublishUploads: async () => [],
    getPublishPayload: async () => [],
  }
  const actor = createActor(createAttestations, {
    input: {
      context: { address: ACCOUNT, account: {}, item, arweaveTransactions: [], publishUploads: [] } as any,
      event: {},
    },
  })
  actor.start()
  await expect(toPromise(actor)).rejects.toMatchObject({ code: 'MODULAR_SIGNER_ACTIVATION_FAILED' })
  expect(sendTransaction).not.toHaveBeenCalled()
})

import { afterEach, describe, expect, mock, test } from 'bun:test'
import { decodeFunctionData, encodeErrorResult, encodeEventTopics, RawContractError, type Log } from 'viem'
import { executorModuleAbi } from './abi/executor'
import { seedExecutorRouterAbi } from './abi/seedExecutorRouter'

const ACCOUNT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const EXECUTOR = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const ADMIN = '0xadadadadadadadadadadadadadadadadadadadad'
const EAS = '0x4200000000000000000000000000000000000021'

const installedLog = (account = ACCOUNT) =>
  ({
    address: account,
    topics: encodeEventTopics({ abi: seedExecutorRouterAbi, eventName: 'SeedExecutorInstalled', args: { executor: EXECUTOR } }),
    data: '0x',
  }) as unknown as Log
const initializedLog = (account = ACCOUNT) =>
  ({
    address: EXECUTOR,
    topics: encodeEventTopics({ abi: executorModuleAbi, eventName: 'ModuleInitialized', args: { account, eas: EAS } }),
    data: '0x',
  }) as unknown as Log

const state = {
  router: { executor: EXECUTOR, eas: '0x4200000000000000000000000000000000000021' } as
    | { executor: string; eas: string }
    | null,
  installed: false,
  sent: [] as Array<{ from: string; to: string; data: `0x${string}` }>,
  receipt: { status: 'success', logs: [installedLog(), initializedLog()] } as { status: string; logs: Log[] },
  /** What simulating installSeedExecutor throws; undefined = it would succeed. */
  simulateError: undefined as Error | undefined,
}

const contractsActual = await import('./contracts')
mock.module('./contracts', () => ({
  ...contractsActual,
  readSeedExecutorRouter: async () => state.router,
  readSeedExecutorInstalled: async () => state.installed,
}))

const chainClientActual = await import('./chainClient')
mock.module('./chainClient', () => ({
  ...chainClientActual,
  isContractDeployed: async () => true,
  waitForPublishReceipt: async (hash: string) => {
    if (state.receipt.status === 'reverted') {
      const { PublishTransactionRevertedError } = await import('../errors')
      throw new PublishTransactionRevertedError(hash, state.receipt)
    }
    return state.receipt
  },
  getPublishPublicClient: () => ({
    call: async () => {
      if (state.simulateError) throw state.simulateError
      return { data: '0x' }
    },
  }),
}))

mock.module('./managedAccountAdmin', () => ({
  getManagedAccountAdmin: async () => ({ address: ADMIN }),
}))

mock.module('./adapters/thirdwebAccount', () => ({
  fromThirdwebAccount: (account: { address: string }) => ({
    signer: { address: account.address },
    txSender: {
      address: account.address,
      sendTransaction: async (tx: { to: string; data: `0x${string}` }) => {
        state.sent.push({ from: account.address, to: tx.to, data: tx.data })
        return { transactionHash: `0x${'12'.repeat(32)}` }
      },
    },
  }),
}))

const { setConfigRef } = await import('../config')
const { ensureExecutorModuleInstalled } = await import('./ensureExecutorModule')

const smartAccount = { address: ACCOUNT } as never
const config = { modularAccountModuleContract: EXECUTOR }

afterEach(() => {
  state.router = { executor: EXECUTOR, eas: '0x4200000000000000000000000000000000000021' }
  state.installed = false
  state.sent = []
  state.receipt = { status: 'success', logs: [installedLog(), initializedLog()] }
  state.simulateError = undefined
})

const revert = (errorName: 'SeedExecutorAlreadyInstalled' | 'Unauthorized', args?: readonly [string]) =>
  new RawContractError({
    data: encodeErrorResult({ abi: seedExecutorRouterAbi, errorName, args } as never),
  })

setConfigRef({ uploadApiBaseUrl: 'https://example.com', rpcUrl: 'https://rpc.invalid', thirdwebClientId: 'test' })

describe('ensureExecutorModuleInstalled on Router accounts with the executor extension', () => {
  test('the admin EOA sends installSeedExecutor to the account', async () => {
    await expect(ensureExecutorModuleInstalled(ACCOUNT, smartAccount, config)).resolves.toMatchObject({
      status: 'installed',
      eas: EAS,
    })
    expect(state.sent).toHaveLength(1)
    expect(state.sent[0]?.from).toBe(ADMIN)
    expect(state.sent[0]?.to).toBe(ACCOUNT)
    const decoded = decodeFunctionData({ abi: seedExecutorRouterAbi, data: state.sent[0]!.data })
    expect(decoded.functionName).toBe('installSeedExecutor')
  })

  test('does nothing when the executor is already installed', async () => {
    state.installed = true
    await expect(ensureExecutorModuleInstalled(ACCOUNT, smartAccount, config)).resolves.toEqual({
      status: 'already-installed',
    })
    expect(state.sent).toHaveLength(0)
  })

  test('fails with the revert reason when the receipt shows no install (sponsored send)', async () => {
    state.receipt = { status: 'success', logs: [] }
    state.simulateError = revert('Unauthorized', [ADMIN])
    await expect(ensureExecutorModuleInstalled(ACCOUNT, smartAccount, config)).rejects.toMatchObject({
      code: 'EXECUTOR_MODULE_NOT_INSTALLED',
      message: expect.stringMatching(/did not install.*reverted with Unauthorized\(0xadad/i),
    })
  })

  test('fails with the revert reason when the install transaction reverted', async () => {
    state.receipt = { status: 'reverted', logs: [] }
    state.simulateError = revert('Unauthorized', [ADMIN])
    await expect(ensureExecutorModuleInstalled(ACCOUNT, smartAccount, config)).rejects.toMatchObject({
      code: 'EXECUTOR_MODULE_NOT_INSTALLED',
      message: expect.stringContaining('reverted with Unauthorized'),
    })
  })

  test('ignores install events for other accounts', async () => {
    const other = '0xcccccccccccccccccccccccccccccccccccccccc'
    state.receipt = { status: 'success', logs: [installedLog(other), initializedLog(other)] }
    await expect(ensureExecutorModuleInstalled(ACCOUNT, smartAccount, config)).rejects.toMatchObject({
      code: 'EXECUTOR_MODULE_NOT_INSTALLED',
    })
  })

  test('treats a receipt without the install as installed when the executor is already installed', async () => {
    state.receipt = { status: 'success', logs: [] }
    state.simulateError = revert('SeedExecutorAlreadyInstalled')
    await expect(ensureExecutorModuleInstalled(ACCOUNT, smartAccount, config)).resolves.toEqual({
      status: 'already-installed',
    })
  })

  test('refuses when the account pins a different executor than config', async () => {
    state.router = { executor: '0xcccccccccccccccccccccccccccccccccccccccc', eas: '0x4200000000000000000000000000000000000021' }
    await expect(ensureExecutorModuleInstalled(ACCOUNT, smartAccount, config)).rejects.toMatchObject({
      code: 'EXECUTOR_MODULE_NOT_INSTALLED',
      message: expect.stringContaining('0xcccccccccccccccccccccccccccccccccccccccc'),
    })
    expect(state.sent).toHaveLength(0)
  })
})

describe('ensureExecutorModuleInstalled on other accounts', () => {
  test('accounts without the executor router extension are skipped', async () => {
    state.router = null
    await expect(ensureExecutorModuleInstalled(ACCOUNT, smartAccount, config)).resolves.toEqual({
      status: 'skipped',
    })
    expect(state.sent).toHaveLength(0)
  })
})

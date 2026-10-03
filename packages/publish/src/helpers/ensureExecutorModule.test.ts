import { afterEach, describe, expect, mock, test } from 'bun:test'
import { decodeFunctionData } from 'viem'
import { seedExecutorRouterAbi } from './abi/seedExecutorRouter'

const ACCOUNT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const EXECUTOR = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const ADMIN = '0xadadadadadadadadadadadadadadadadadadadad'

const state = {
  router: { executor: EXECUTOR, eas: '0x4200000000000000000000000000000000000021' } as
    | { executor: string; eas: string }
    | null,
  installed: false,
  sent: [] as Array<{ from: string; to: string; data: `0x${string}` }>,
  modularCoreInstalled: [] as Array<{ implementation: string }>,
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
  waitForPublishReceipt: async () => ({ status: 'success' }),
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

const modulesActual = await import('thirdweb/modules')
mock.module('thirdweb/modules', () => ({
  ...modulesActual,
  getInstalledModules: async () => state.modularCoreInstalled,
}))

const { setConfigRef } = await import('../config')
const { ensureExecutorModuleInstalled } = await import('./ensureExecutorModule')

const smartAccount = { address: ACCOUNT } as never
const config = { modularAccountModuleContract: EXECUTOR }

afterEach(() => {
  state.router = { executor: EXECUTOR, eas: '0x4200000000000000000000000000000000000021' }
  state.installed = false
  state.sent = []
  state.modularCoreInstalled = []
})

setConfigRef({ uploadApiBaseUrl: 'https://example.com', rpcUrl: 'https://rpc.invalid', thirdwebClientId: 'test' })

describe('ensureExecutorModuleInstalled on Router accounts with the executor extension', () => {
  test('the admin EOA sends installSeedExecutor to the account', async () => {
    await ensureExecutorModuleInstalled(ACCOUNT, smartAccount, config)
    expect(state.sent).toHaveLength(1)
    expect(state.sent[0]?.from).toBe(ADMIN)
    expect(state.sent[0]?.to).toBe(ACCOUNT)
    const decoded = decodeFunctionData({ abi: seedExecutorRouterAbi, data: state.sent[0]!.data })
    expect(decoded.functionName).toBe('installSeedExecutor')
  })

  test('does nothing when the executor is already installed', async () => {
    state.installed = true
    await ensureExecutorModuleInstalled(ACCOUNT, smartAccount, config)
    expect(state.sent).toHaveLength(0)
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
  test('ModularCore accounts with the module installed send nothing', async () => {
    state.router = null
    state.modularCoreInstalled = [{ implementation: EXECUTOR }]
    await ensureExecutorModuleInstalled(ACCOUNT, smartAccount, config)
    expect(state.sent).toHaveLength(0)
  })
})

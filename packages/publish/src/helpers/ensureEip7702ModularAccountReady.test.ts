import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const cfg = { autoDeployEip7702ModularAccount: true }
let icdN = 0
let icdAlwaysTrue = false

const deploySmartAccountMock = mock(async () => {})
const isContractDeployedMock = mock(async () => {
  if (icdAlwaysTrue) return true
  icdN++
  return icdN > 1
})
const pollSmartWalletDeployedMock = mock(async (addr: string, attempts?: number) => {
  for (let i = 0; i < (attempts ?? 5); i++) {
    if (await isContractDeployedMock(addr)) return true
  }
  return false
})

mock.module('../config', () => ({
  getPublishConfig: () => cfg,
}))

mock.module('./thirdweb', () => ({
  getClient: () => ({}),
  getModularAccountWallet: () => ({
    autoConnect: mock(() => Promise.resolve()),
    getAccount: () => ({ address: '0x1234567890123456789012345678901234567890' }),
  }),
  getManagedAccountWallet: () => ({
    autoConnect: mock(() => Promise.resolve()),
    getAccount: () => ({ address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }),
  }),
  isSmartWalletDeployed: mock(async () => true),
  pollSmartWalletDeployed: mock(async () => true),
  getConnectedModularAccount: mock(async () => null),
  getConnectedManagedAccountAddress: mock(async () => '0xmanaged'),
  getConnectedAccount: mock(async () => null),
}))

mock.module('./chainClient', () => ({
  isContractDeployed: (...args: unknown[]) => isContractDeployedMock(...(args as [string])),
  pollSmartWalletDeployed: (...args: unknown[]) =>
    pollSmartWalletDeployedMock(...(args as [string, number?])),
}))

mock.module('thirdweb', () => ({
  createThirdwebClient: mock(() => ({})),
  deploySmartAccount: deploySmartAccountMock,
  getContract: mock(() => ({})),
  prepareTransaction: mock(() => ({})),
  sendTransaction: mock(async () => ({ transactionHash: '0x' })),
  defineChain: mock((c: unknown) => c),
}))

afterEach(() => {
  cfg.autoDeployEip7702ModularAccount = true
  icdN = 0
  icdAlwaysTrue = false
  deploySmartAccountMock.mockClear()
  isContractDeployedMock.mockClear()
})

describe('ensureEip7702ModularAccountReady', () => {
  beforeEach(() => {
    cfg.autoDeployEip7702ModularAccount = true
    icdN = 0
    icdAlwaysTrue = false
    deploySmartAccountMock.mockClear()
    isContractDeployedMock.mockClear()
    isContractDeployedMock.mockImplementation(async () => {
      if (icdAlwaysTrue) return true
      icdN++
      return icdN > 1
    })
  })

  test('calls deploySmartAccount when chain bytecode is empty then ready', async () => {
    const { ensureEip7702ModularAccountReady } = await import('./ensureEip7702ModularAccountReady')
    await ensureEip7702ModularAccountReady()
    expect(deploySmartAccountMock).toHaveBeenCalledTimes(1)
  })

  test('skips deploy when already deployed', async () => {
    icdAlwaysTrue = true
    const { ensureEip7702ModularAccountReady } = await import('./ensureEip7702ModularAccountReady')
    await ensureEip7702ModularAccountReady()
    expect(deploySmartAccountMock).not.toHaveBeenCalled()
  })

  test('throws when auto-deploy off and not deployed', async () => {
    cfg.autoDeployEip7702ModularAccount = false
    icdN = 0
    icdAlwaysTrue = false
    const { ensureEip7702ModularAccountReady } = await import('./ensureEip7702ModularAccountReady')
    const { Eip7702ModularAccountPublishError } = await import('../errors')
    await expect(ensureEip7702ModularAccountReady()).rejects.toBeInstanceOf(Eip7702ModularAccountPublishError)
  })

  test('succeeds when deploy throws but bytecode appears after polling', async () => {
    deploySmartAccountMock.mockImplementationOnce(() => Promise.reject(new Error('timeout')))
    icdN = 0
    icdAlwaysTrue = false
    const { ensureEip7702ModularAccountReady } = await import('./ensureEip7702ModularAccountReady')
    await ensureEip7702ModularAccountReady()
    expect(deploySmartAccountMock).toHaveBeenCalledTimes(1)
  })
})

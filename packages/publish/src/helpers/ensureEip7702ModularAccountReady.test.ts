import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const cfg = { autoDeployEip7702ModularAccount: true }
let icdN = 0
let icdAlwaysTrue = false

const deploySmartAccountMock = mock(async () => {})

mock.module('../config', () => ({
  getPublishConfig: () => cfg,
}))

mock.module('./thirdweb', () => ({
  getClient: () => ({}),
  getModularAccountWallet: () => ({
    autoConnect: mock(() => Promise.resolve()),
    getAccount: () => ({ address: '0x1234567890123456789012345678901234567890' }),
  }),
}))

mock.module('thirdweb/utils', () => ({
  isContractDeployed: mock(async () => {
    if (icdAlwaysTrue) return true
    icdN++
    return icdN > 1
  }),
}))

mock.module('thirdweb', () => ({
  deploySmartAccount: deploySmartAccountMock,
  getContract: mock(() => ({})),
}))

afterEach(() => {
  cfg.autoDeployEip7702ModularAccount = true
  icdN = 0
  icdAlwaysTrue = false
  deploySmartAccountMock.mockClear()
})

describe('ensureEip7702ModularAccountReady', () => {
  beforeEach(() => {
    cfg.autoDeployEip7702ModularAccount = true
    icdN = 0
    icdAlwaysTrue = false
    deploySmartAccountMock.mockClear()
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
})

import { afterEach, describe, expect, mock, test } from 'bun:test'

const modularAccount = { address: '0xmodular0000000000000000000000000000000001' }
const cfg = { autoDeployEip7702ModularAccount: true }

const ensureManagedSignerSessionKeyMock = mock(() => Promise.resolve())
const ensureManagedAccountEasConfiguredMock = mock(() => Promise.resolve())
const ensureEip7702ModularAccountReadyMock = mock(() => Promise.resolve())

mock.module('../config', () => ({
  getPublishConfig: () => cfg,
}))

mock.module('./thirdweb', () => ({
  getClient: () => ({}),
  getModularAccountWallet: () => ({
    autoConnect: mock(() => Promise.resolve()),
    getAccount: () => modularAccount,
  }),
}))

mock.module('./ensureManagedSignerSessionKey', () => ({
  ensureManagedSignerSessionKey: (...args: unknown[]) => ensureManagedSignerSessionKeyMock(...args),
}))

mock.module('./ensureManagedAccountEasConfigured', () => ({
  ensureManagedAccountEasConfigured: (...args: unknown[]) => ensureManagedAccountEasConfiguredMock(...args),
}))

mock.module('./ensureEip7702ModularAccountReady', () => ({
  ensureEip7702ModularAccountReady: (...args: unknown[]) => ensureEip7702ModularAccountReadyMock(...args),
}))

afterEach(() => {
  cfg.autoDeployEip7702ModularAccount = true
  ensureManagedSignerSessionKeyMock.mockClear()
  ensureManagedAccountEasConfiguredMock.mockClear()
  ensureEip7702ModularAccountReadyMock.mockClear()
  ensureManagedSignerSessionKeyMock.mockImplementation(() => Promise.resolve())
  ensureManagedAccountEasConfiguredMock.mockImplementation(() => Promise.resolve())
  ensureEip7702ModularAccountReadyMock.mockImplementation(() => Promise.resolve())
})

describe('ensureModularPublishBootstrap', () => {
  test('runs signer activation then EAS config and returns modular account', async () => {
    const { ensureModularPublishBootstrap } = await import('./ensureModularPublishBootstrap')
    const account = await ensureModularPublishBootstrap('0xmanaged')
    expect(account).toBe(modularAccount)
    expect(ensureManagedSignerSessionKeyMock).toHaveBeenCalledWith({
      managedAddress: '0xmanaged',
      signerAddress: modularAccount.address,
    })
    expect(ensureManagedAccountEasConfiguredMock).toHaveBeenCalledWith('0xmanaged', modularAccount)
    expect(ensureEip7702ModularAccountReadyMock).not.toHaveBeenCalled()
  })

  test('falls back to EIP-7702 when signer activation fails and auto-deploy is on', async () => {
    const { ManagedAccountPublishError } = await import('../errors')
    ensureManagedSignerSessionKeyMock.mockImplementationOnce(() =>
      Promise.reject(
        new ManagedAccountPublishError('activation failed', 'MODULAR_SIGNER_ACTIVATION_FAILED', '0xmanaged'),
      ),
    )
    const { ensureModularPublishBootstrap } = await import('./ensureModularPublishBootstrap')
    await ensureModularPublishBootstrap('0xmanaged')
    expect(ensureEip7702ModularAccountReadyMock).toHaveBeenCalledTimes(1)
    expect(ensureManagedAccountEasConfiguredMock).toHaveBeenCalledWith('0xmanaged', modularAccount)
  })

  test('rethrows signer activation when auto-deploy EIP-7702 is off', async () => {
    cfg.autoDeployEip7702ModularAccount = false
    const { ManagedAccountPublishError } = await import('../errors')
    const err = new ManagedAccountPublishError('activation failed', 'MODULAR_SIGNER_ACTIVATION_FAILED', '0xmanaged')
    ensureManagedSignerSessionKeyMock.mockImplementationOnce(() => Promise.reject(err))
    const { ensureModularPublishBootstrap } = await import('./ensureModularPublishBootstrap')
    await expect(ensureModularPublishBootstrap('0xmanaged')).rejects.toBe(err)
    expect(ensureEip7702ModularAccountReadyMock).not.toHaveBeenCalled()
  })
})

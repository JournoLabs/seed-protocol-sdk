import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'

const wallet = (address: string) => ({
  signer: { address: '0xad', signMessage: async () => '0x' as const },
  txSender: { address, sendTransaction: async () => ({ transactionHash: '0x' as const }) },
})
/** Sends as the account, like createManagedAccountTxSender. */
const userWallet = wallet('0xmanaged') as never
const admin = wallet('0xad') as never
const ensureExecutorModuleInstalledMock = mock(async (): Promise<unknown> => ({ status: 'already-installed' }))
const ensureAutomationSessionKeyMock = mock(async () => {})
const removeAutomationSessionKeyMock = mock(async () => {})
const attestPublishAuthorizationMock = mock(async () => ({
  uid: `0x${'11'.repeat(32)}`,
  schemaUid: `0x${'22'.repeat(32)}`,
  permissionsHash: `0x${'33'.repeat(32)}`,
  grantedAt: 1,
  expiresAt: 0,
  expirationTime: 2,
}))
const revokePublishAuthorizationMock = mock(async (_params: unknown) => {})
/** Live PublishAuthorization uids for the account, session key and app, before this enroll. */
let liveAuthorizations: string[] = []
const findLivePublishAuthorizationUidsMock = mock(async (_params: unknown) => liveAuthorizations)
const assertExecutorModuleReadyMock = mock(async () => {})
const assertAutomationExposureAllowedMock = mock(async () => {})

mock.module('./automationExposure', () => ({
  assertAutomationExposureAllowed: (...args: unknown[]) => assertAutomationExposureAllowedMock(...args),
}))

mock.module('../config', () => ({
  getConfigRef: () => null,
  getPublishConfig: () => ({
    modularAccountModuleContract: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  }),
  setConfigRef: () => {},
  initPublish: () => {},
}))

mock.module('./ensureExecutorModule', () => ({
  ensureExecutorModuleInstalled: (...args: unknown[]) =>
    ensureExecutorModuleInstalledMock(...args),
}))

mock.module('./executorModuleReadiness', () => ({
  assertExecutorModuleReadyForAccount: (...args: unknown[]) =>
    assertExecutorModuleReadyMock(...args),
  simulateCallFromAccount: mock(async () => {}),
}))

mock.module('./ensureAutomationSessionKey', () => ({
  ensureAutomationSessionKey: (...args: unknown[]) => ensureAutomationSessionKeyMock(...args),
  removeAutomationSessionKey: (...args: unknown[]) => removeAutomationSessionKeyMock(...args),
  isAutomationSessionActive: mock(async () => true),
}))

mock.module('../services/publishAuthorization', () => ({
  attestPublishAuthorization: (...args: unknown[]) => attestPublishAuthorizationMock(...args),
  revokePublishAuthorization: (...args: unknown[]) => revokePublishAuthorizationMock(...(args as [unknown])),
  findLivePublishAuthorizationUids: (...args: unknown[]) => findLivePublishAuthorizationUidsMock(...(args as [unknown])),
}))

afterEach(() => {
  liveAuthorizations = []
  findLivePublishAuthorizationUidsMock.mockClear()
  ensureExecutorModuleInstalledMock.mockClear()
  ensureAutomationSessionKeyMock.mockClear()
  removeAutomationSessionKeyMock.mockClear()
  attestPublishAuthorizationMock.mockClear()
  revokePublishAuthorizationMock.mockClear()
  assertExecutorModuleReadyMock.mockClear()
  assertExecutorModuleReadyMock.mockImplementation(async () => {})
  assertAutomationExposureAllowedMock.mockClear()
  assertAutomationExposureAllowedMock.mockImplementation(async () => {})
  ensureExecutorModuleInstalledMock.mockImplementation(async () => ({ status: 'already-installed' }))
})

function firstArg(fn: { mock: { calls: unknown[] } }): { expiresAt?: number } {
  return (fn.mock.calls[0] as [{ expiresAt?: number }])[0]
}

describe('enrollPublishAutomation', () => {
  test('installs module, adds session key, attests sidecar', async () => {
    const { enrollPublishAutomation } = await import('./enrollPublishAutomation')
    const result = await enrollPublishAutomation({
      managedAddress: '0xmanaged',
      sessionKeyAddress: '0xsession',
      userWallet,
      admin,
    })
    expect(ensureExecutorModuleInstalledMock).toHaveBeenCalled()
    expect(assertExecutorModuleReadyMock).toHaveBeenCalledWith('0xmanaged', { readAttempts: 5 })
    expect(ensureAutomationSessionKeyMock).toHaveBeenCalled()
    expect(attestPublishAuthorizationMock).toHaveBeenCalled()
    expect(result.authorization.uid).toMatch(/^0x/)
  })

  test('fails before adding the session key when the executor install fails', async () => {
    ensureExecutorModuleInstalledMock.mockImplementationOnce(async () => {
      throw new Error('installSeedExecutor reverted')
    })
    const { enrollPublishAutomation } = await import('./enrollPublishAutomation')
    await expect(
      enrollPublishAutomation({
        managedAddress: '0xmanaged',
        sessionKeyAddress: '0xsession',
        userWallet,
        admin,
      }),
    ).rejects.toMatchObject({ code: 'EXECUTOR_MODULE_NOT_INSTALLED' })
    expect(ensureAutomationSessionKeyMock).not.toHaveBeenCalled()
  })

  test('refuses an account the executor cannot act for before adding the session key', async () => {
    const { ManagedAccountPublishError } = await import('../errors')
    assertExecutorModuleReadyMock.mockImplementationOnce(async () => {
      throw new ManagedAccountPublishError(
        'legacy Router account',
        'AUTOMATION_UNSUPPORTED_ACCOUNT',
        '0xmanaged',
      )
    })
    const { enrollPublishAutomation } = await import('./enrollPublishAutomation')
    await expect(
      enrollPublishAutomation({
        managedAddress: '0xmanaged',
        sessionKeyAddress: '0xsession',
        userWallet,
        admin,
      }),
    ).rejects.toMatchObject({ code: 'AUTOMATION_UNSUPPORTED_ACCOUNT' })
    expect(assertExecutorModuleReadyMock).toHaveBeenCalledWith('0xmanaged', { readAttempts: 5 })
    expect(ensureAutomationSessionKeyMock).not.toHaveBeenCalled()
    expect(attestPublishAuthorizationMock).not.toHaveBeenCalled()
  })

  test('checks a fresh install against its receipt instead of re-reading the module', async () => {
    const eas = '0x4200000000000000000000000000000000000021'
    ensureExecutorModuleInstalledMock.mockImplementationOnce(async () => ({
      status: 'installed',
      eas,
      transactionHash: `0x${'12'.repeat(32)}`,
    }))
    const { enrollPublishAutomation } = await import('./enrollPublishAutomation')
    await enrollPublishAutomation({ managedAddress: '0xmanaged', sessionKeyAddress: '0xsession', userWallet, admin })
    expect(assertExecutorModuleReadyMock).toHaveBeenCalledWith('0xmanaged', { installedEas: eas })
    expect(ensureAutomationSessionKeyMock).toHaveBeenCalled()
  })

  test('grants the session key with userWallet and attests the sidecar with it', async () => {
    const { enrollPublishAutomation } = await import('./enrollPublishAutomation')
    await enrollPublishAutomation({ managedAddress: '0xmanaged', sessionKeyAddress: '0xsession', userWallet })
    expect(firstArg(ensureAutomationSessionKeyMock)).toMatchObject({ admin: userWallet })
    expect(firstArg(attestPublishAuthorizationMock)).toMatchObject({ wallet: userWallet, identity: '0xmanaged' })
  })

  test('refuses a userWallet that does not send as the account, before sending anything', async () => {
    const { enrollPublishAutomation } = await import('./enrollPublishAutomation')
    await expect(
      enrollPublishAutomation({ managedAddress: '0xmanaged', sessionKeyAddress: '0xsession', userWallet: admin }),
    ).rejects.toMatchObject({ code: 'MANAGED_ACCOUNT_UNAVAILABLE' })
    expect(ensureExecutorModuleInstalledMock).not.toHaveBeenCalled()
    expect(ensureAutomationSessionKeyMock).not.toHaveBeenCalled()
  })

  test('refuses an account over the ETH limit before sending anything', async () => {
    const { ManagedAccountPublishError } = await import('../errors')
    assertAutomationExposureAllowedMock.mockImplementationOnce(async () => {
      throw new ManagedAccountPublishError('over the limit', 'AUTOMATION_ACCOUNT_FUNDED', '0xmanaged')
    })
    const { enrollPublishAutomation } = await import('./enrollPublishAutomation')
    await expect(
      enrollPublishAutomation({ managedAddress: '0xmanaged', sessionKeyAddress: '0xsession', userWallet, admin }),
    ).rejects.toMatchObject({ code: 'AUTOMATION_ACCOUNT_FUNDED' })
    expect(ensureExecutorModuleInstalledMock).not.toHaveBeenCalled()
    expect(ensureAutomationSessionKeyMock).not.toHaveBeenCalled()
    expect(attestPublishAuthorizationMock).not.toHaveBeenCalled()
  })

  test('asks for admin only when the executor has to be installed', async () => {
    ensureExecutorModuleInstalledMock.mockImplementationOnce(async (...args: unknown[]) => {
      const getAdmin = args[1] as () => Promise<unknown>
      await getAdmin()
      return { status: 'installed', eas: '0x4200000000000000000000000000000000000021', transactionHash: '0x' }
    })
    const { enrollPublishAutomation } = await import('./enrollPublishAutomation')
    await expect(
      enrollPublishAutomation({ managedAddress: '0xmanaged', sessionKeyAddress: '0xsession', userWallet }),
    ).rejects.toThrow(/pass the account's admin EOA as `admin`/)
    expect(ensureAutomationSessionKeyMock).not.toHaveBeenCalled()
  })

  test('reads once for accounts the install step skipped', async () => {
    ensureExecutorModuleInstalledMock.mockImplementationOnce(async () => ({ status: 'skipped' }))
    const { enrollPublishAutomation } = await import('./enrollPublishAutomation')
    await enrollPublishAutomation({ managedAddress: '0xmanaged', sessionKeyAddress: '0xsession', userWallet, admin })
    expect(assertExecutorModuleReadyMock).toHaveBeenCalledWith('0xmanaged', { readAttempts: 1 })
  })
})

// Batch 16 item 14 (D48): a renewal leaves only the newest grant live
describe('enrollPublishAutomation renewal', () => {
  const OLD = `0x${'aa'.repeat(32)}`
  const NEW = `0x${'11'.repeat(32)}`

  test('revokes the earlier PublishAuthorization once the new one lands', async () => {
    liveAuthorizations = [OLD]
    const { enrollPublishAutomation } = await import('./enrollPublishAutomation')
    const result = await enrollPublishAutomation({
      managedAddress: '0xmanaged',
      sessionKeyAddress: '0xsession',
      appAddress: '0xapp',
      userWallet,
      admin,
    })
    expect(findLivePublishAuthorizationUidsMock.mock.calls[0]![0]).toEqual({
      identity: '0xmanaged',
      sessionKey: '0xsession',
      app: '0xapp',
    })
    expect(revokePublishAuthorizationMock.mock.calls).toEqual([[{ wallet: userWallet, uid: OLD }]])
    expect(attestPublishAuthorizationMock.mock.invocationCallOrder[0]!).toBeLessThan(
      revokePublishAuthorizationMock.mock.invocationCallOrder[0]!,
    )
    expect(result.authorization.uid).toBe(NEW)
    expect(result.revokedAuthorizationUids).toEqual([OLD])
  })

  test('a failed revoke or lookup still returns the new grant', async () => {
    const error = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      liveAuthorizations = [OLD]
      revokePublishAuthorizationMock.mockImplementationOnce(async () => {
        throw new Error('revert')
      })
      const { enrollPublishAutomation } = await import('./enrollPublishAutomation')
      const renewed = await enrollPublishAutomation({ managedAddress: '0xmanaged', sessionKeyAddress: '0xsession', userWallet, admin })
      expect(renewed.authorization.uid).toBe(NEW)
      expect(renewed.revokedAuthorizationUids).toEqual([])

      findLivePublishAuthorizationUidsMock.mockImplementationOnce(async () => {
        throw new Error('indexer down')
      })
      const looked = await enrollPublishAutomation({ managedAddress: '0xmanaged', sessionKeyAddress: '0xsession', userWallet, admin })
      expect(looked.authorization.uid).toBe(NEW)
    } finally {
      error.mockRestore()
    }
  })

  test('a first enroll revokes nothing', async () => {
    const { enrollPublishAutomation } = await import('./enrollPublishAutomation')
    const result = await enrollPublishAutomation({ managedAddress: '0xmanaged', sessionKeyAddress: '0xsession', userWallet, admin })
    expect(revokePublishAuthorizationMock).not.toHaveBeenCalled()
    expect(result.revokedAuthorizationUids).toEqual([])
  })
})

// Batch 16 item 15: the /thirdweb wrapper passes admin as a function, connected only for an install
describe('enrollPublishAutomation admin', () => {
  test('a lazy admin is not called when the executor is already installed', async () => {
    const getAdmin = mock(async () => admin)
    const { enrollPublishAutomation } = await import('./enrollPublishAutomation')
    await enrollPublishAutomation({ managedAddress: '0xmanaged', sessionKeyAddress: '0xsession', userWallet, admin: getAdmin })
    expect(getAdmin).not.toHaveBeenCalled()
  })

  test('a lazy admin is called for an install', async () => {
    const getAdmin = mock(async () => admin)
    ensureExecutorModuleInstalledMock.mockImplementationOnce(async (...args: unknown[]) => {
      expect(await (args[1] as () => Promise<unknown>)()).toBe(admin)
      return { status: 'installed', eas: '0x4200000000000000000000000000000000000021', transactionHash: '0x' }
    })
    const { enrollPublishAutomation } = await import('./enrollPublishAutomation')
    await enrollPublishAutomation({ managedAddress: '0xmanaged', sessionKeyAddress: '0xsession', userWallet, admin: getAdmin })
    expect(getAdmin).toHaveBeenCalledTimes(1)
  })
})

describe('enrollPublishAutomation expiry', () => {
  test('defaults to 90 days and gives the session key and the grant the same end', async () => {
    const days90 = 90 * 24 * 60 * 60
    const { enrollPublishAutomation } = await import('./enrollPublishAutomation')
    const before = Math.floor(Date.now() / 1000)
    await enrollPublishAutomation({ managedAddress: '0xmanaged', sessionKeyAddress: '0xsession', userWallet, admin })
    const after = Math.floor(Date.now() / 1000)

    const keyArgs = firstArg(ensureAutomationSessionKeyMock)
    const grantArgs = firstArg(attestPublishAuthorizationMock)
    expect(keyArgs.expiresAt).toBe(grantArgs.expiresAt)
    expect(keyArgs.expiresAt).toBeGreaterThanOrEqual(before + days90)
    expect(keyArgs.expiresAt).toBeLessThanOrEqual(after + days90)
  })

  test('passes a given expiresAt to both', async () => {
    const { enrollPublishAutomation } = await import('./enrollPublishAutomation')
    await enrollPublishAutomation({
      managedAddress: '0xmanaged',
      sessionKeyAddress: '0xsession',
      expiresAt: 2_000_000_000,
      userWallet,
    })
    const keyArgs = firstArg(ensureAutomationSessionKeyMock)
    const grantArgs = firstArg(attestPublishAuthorizationMock)
    expect(keyArgs.expiresAt).toBe(2_000_000_000)
    expect(grantArgs.expiresAt).toBe(2_000_000_000)
  })
})

describe('revokePublishAutomation', () => {
  test('removes session key and revokes sidecar', async () => {
    const { revokePublishAutomation } = await import('./enrollPublishAutomation')
    await revokePublishAutomation({
      managedAddress: '0xmanaged',
      sessionKeyAddress: '0xsession',
      authorizationUid: `0x${'11'.repeat(32)}`,
      userWallet,
    })
    expect(firstArg(removeAutomationSessionKeyMock)).toMatchObject({ admin: userWallet })
    expect(revokePublishAuthorizationMock).toHaveBeenCalled()
  })
})

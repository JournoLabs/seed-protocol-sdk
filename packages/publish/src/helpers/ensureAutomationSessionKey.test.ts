import { afterEach, describe, expect, mock, test } from 'bun:test'
import { Wallet } from 'ethers'
import { decodeFunctionData, getAddress, recoverTypedDataAddress, type Address, type Hex } from 'viem'
import { optimismSepolia } from 'viem/chains'
import { accountPermissionsAbi, signerPermissionRequestTypes } from './abi/accountPermissions'
import { brandTxSender, fromEthersWallet, type PublishWallet, type SeedTxRequest } from './seedSigner'

const MANAGED = getAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
const SESSION = getAddress('0x5e5510000000000000000000000000000000c0de')
const EXECUTOR = getAddress('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')

const readIsActiveSignerMock = mock(async () => true)
const readIsAdminMock = mock(async () => true)
const readPermissionsForSignerMock = mock(async () => ({
  approvedTargets: [EXECUTOR] as readonly Address[],
  nativeTokenLimitPerTransaction: 0n,
  startTimestamp: 0n,
  endTimestamp: BigInt(Math.floor(Date.now() / 1000) + 3600),
}))
const isContractDeployedMock = mock(async () => true)
const waitForPublishReceiptMock = mock(async () => ({ status: 'success' }))

const config = await import('../config')
mock.module('../config', () => ({
  ...config,
  getPublishConfig: () => ({ modularAccountModuleContract: EXECUTOR, chain: optimismSepolia }),
}))

const contracts = await import('./contracts')
mock.module('./contracts', () => ({
  ...contracts,
  readIsActiveSigner: (...args: unknown[]) => readIsActiveSignerMock(...(args as [])),
  readIsAdmin: (...args: unknown[]) => readIsAdminMock(...(args as [])),
  readPermissionsForSigner: (...args: unknown[]) => readPermissionsForSignerMock(...(args as [])),
}))

const { readUntil } = await import('./chainClient')
mock.module('./chainClient', () => ({
  readUntil: (read: () => Promise<unknown>, accept: (v: unknown) => boolean, opts?: { attempts?: number }) =>
    readUntil(read, accept, { ...opts, intervalMs: 0 }),
  waitForPublishReceipt: (...args: unknown[]) => waitForPublishReceiptMock(...(args as [])),
  isContractDeployed: (...args: unknown[]) => isContractDeployedMock(...(args as [])),
}))

const {
  assertSessionKeyApprovesExecutor,
  ensureAutomationSessionKey,
  removeAutomationSessionKey,
  isAutomationSessionActive,
} = await import('./ensureAutomationSessionKey')

/** An admin EOA's signer with a sender that records what it was asked to send. */
function adminWallet(senderAddress?: Address) {
  const owner = Wallet.createRandom() as unknown as Wallet
  const sent: SeedTxRequest[] = []
  const { signer } = fromEthersWallet(owner)
  const wallet: PublishWallet = {
    signer,
    txSender: brandTxSender({
      address: senderAddress ?? signer.address,
      sendTransaction: async (tx) => {
        sent.push(tx)
        return { transactionHash: `0x${'cd'.repeat(32)}` as Hex }
      },
    }),
  }
  return { owner, wallet, sent }
}

/** The request and the address that signed it, from a sent `setPermissionsForSigner`. */
async function decodeGrant(tx: SeedTxRequest) {
  const { functionName, args } = decodeFunctionData({ abi: accountPermissionsAbi, data: tx.data })
  expect(functionName).toBe('setPermissionsForSigner')
  const [req, signature] = args as unknown as [Record<string, unknown>, Hex]
  const signedBy = await recoverTypedDataAddress({
    domain: { name: 'Account', version: '1', chainId: optimismSepolia.id, verifyingContract: MANAGED },
    types: signerPermissionRequestTypes,
    primaryType: 'SignerPermissionRequest',
    message: req as never,
    signature,
  })
  return { req, signedBy }
}

afterEach(() => {
  for (const m of [
    readIsActiveSignerMock,
    readIsAdminMock,
    readPermissionsForSignerMock,
    isContractDeployedMock,
    waitForPublishReceiptMock,
  ]) {
    m.mockClear()
  }
  readIsActiveSignerMock.mockImplementation(async () => true)
  readIsAdminMock.mockImplementation(async () => true)
  isContractDeployedMock.mockImplementation(async () => true)
  readPermissionsForSignerMock.mockImplementation(async () => ({
    approvedTargets: [EXECUTOR],
    nativeTokenLimitPerTransaction: 0n,
    startTimestamp: 0n,
    endTimestamp: BigInt(Math.floor(Date.now() / 1000) + 3600),
  }))
})

const noTargets = async () => ({
  approvedTargets: [] as readonly Address[],
  nativeTokenLimitPerTransaction: 0n,
  startTimestamp: 0n,
  endTimestamp: 0n,
})

describe('ensureAutomationSessionKey', () => {
  test('sends nothing when the key already has the executor and has not ended', async () => {
    const { wallet, sent } = adminWallet()
    await ensureAutomationSessionKey({ managedAddress: MANAGED, sessionKeyAddress: SESSION, admin: wallet })
    expect(sent).toHaveLength(0)
    expect(readIsActiveSignerMock).toHaveBeenCalled()
  })

  test('sends an executor-only grant signed by the admin, from the admin itself', async () => {
    readPermissionsForSignerMock.mockImplementation(noTargets)
    const { owner, wallet, sent } = adminWallet()
    const expiresAt = Math.floor(Date.now() / 1000) + 86_400
    await ensureAutomationSessionKey({
      managedAddress: MANAGED,
      sessionKeyAddress: SESSION,
      expiresAt,
      admin: wallet,
    })
    expect(sent).toHaveLength(1)
    expect(sent[0]!.to).toBe(MANAGED)
    const { req, signedBy } = await decodeGrant(sent[0]!)
    expect(signedBy).toBe(owner.address as Address)
    expect(req).toMatchObject({
      signer: SESSION,
      isAdmin: 0,
      approvedTargets: [EXECUTOR],
      nativeTokenLimitPerTransaction: 0n,
      permissionStartTimestamp: 0n,
      permissionEndTimestamp: BigInt(expiresAt),
    })
  })

  test('grants again when the key has ended', async () => {
    readPermissionsForSignerMock.mockImplementation(async () => ({
      approvedTargets: [EXECUTOR],
      nativeTokenLimitPerTransaction: 0n,
      startTimestamp: 0n,
      endTimestamp: 1n,
    }))
    const { wallet, sent } = adminWallet()
    await ensureAutomationSessionKey({ managedAddress: MANAGED, sessionKeyAddress: SESSION, admin: wallet })
    expect(sent).toHaveLength(1)
  })

  test('refuses a signer that is not an admin of the account, before sending', async () => {
    readPermissionsForSignerMock.mockImplementation(noTargets)
    readIsAdminMock.mockImplementation(async () => false)
    const { owner, wallet, sent } = adminWallet()
    await expect(
      ensureAutomationSessionKey({ managedAddress: MANAGED, sessionKeyAddress: SESSION, admin: wallet }),
    ).rejects.toThrow(`${owner.address} signed the session-key request but is not an admin`)
    expect(sent).toHaveLength(0)
  })

  test('refuses an undeployed account unless the sender is the account', async () => {
    isContractDeployedMock.mockImplementation(async () => false)
    const { wallet, sent } = adminWallet()
    await expect(
      ensureAutomationSessionKey({ managedAddress: MANAGED, sessionKeyAddress: SESSION, admin: wallet }),
    ).rejects.toMatchObject({ code: 'MODULAR_SIGNER_ACTIVATION_FAILED' })
    expect(sent).toHaveLength(0)
  })

  test('sends to an undeployed account from the account, whose UserOp deploys it', async () => {
    let deployed = false
    isContractDeployedMock.mockImplementation(async () => deployed)
    const { wallet, sent } = adminWallet(MANAGED)
    waitForPublishReceiptMock.mockImplementationOnce(async () => {
      deployed = true
      return { status: 'success' }
    })
    await ensureAutomationSessionKey({ managedAddress: MANAGED, sessionKeyAddress: SESSION, admin: wallet })
    expect(sent).toHaveLength(1)
    expect(readIsAdminMock).not.toHaveBeenCalled()
  })

  test('waits out a lagging RPC node that still reports the new key inactive', async () => {
    readPermissionsForSignerMock.mockImplementation(noTargets)
    readIsActiveSignerMock.mockImplementationOnce(async () => false)
    const { wallet } = adminWallet()
    await ensureAutomationSessionKey({ managedAddress: MANAGED, sessionKeyAddress: SESSION, admin: wallet })
    expect(readIsActiveSignerMock).toHaveBeenCalledTimes(2)
  })

  test('fails when the new key never becomes active', async () => {
    readPermissionsForSignerMock.mockImplementation(noTargets)
    readIsActiveSignerMock.mockImplementation(async () => false)
    const { wallet } = adminWallet()
    await expect(
      ensureAutomationSessionKey({ managedAddress: MANAGED, sessionKeyAddress: SESSION, admin: wallet }),
    ).rejects.toMatchObject({ code: 'MODULAR_SIGNER_ACTIVATION_FAILED' })
    expect(readIsActiveSignerMock).toHaveBeenCalledTimes(5)
  })
})

describe('removeAutomationSessionKey', () => {
  test('sends a grant with no targets that has already ended', async () => {
    const { owner, wallet, sent } = adminWallet()
    await removeAutomationSessionKey({ managedAddress: MANAGED, sessionKeyAddress: SESSION, admin: wallet })
    expect(sent).toHaveLength(1)
    const { req, signedBy } = await decodeGrant(sent[0]!)
    expect(signedBy).toBe(owner.address as Address)
    expect(req).toMatchObject({ signer: SESSION, approvedTargets: [], permissionEndTimestamp: 0n })
  })

  test('sends nothing for an undeployed account', async () => {
    isContractDeployedMock.mockImplementation(async () => false)
    const { wallet, sent } = adminWallet()
    await removeAutomationSessionKey({ managedAddress: MANAGED, sessionKeyAddress: SESSION, admin: wallet })
    expect(sent).toHaveLength(0)
  })
})

describe('isAutomationSessionActive', () => {
  test('returns false when the ManagedAccount has no bytecode', async () => {
    isContractDeployedMock.mockImplementationOnce(async () => false)
    await expect(isAutomationSessionActive(MANAGED, SESSION)).resolves.toBe(false)
    expect(readIsActiveSignerMock).not.toHaveBeenCalled()
  })

  test('returns isActiveSigner when deployed', async () => {
    await expect(isAutomationSessionActive(MANAGED, SESSION)).resolves.toBe(true)
    readIsActiveSignerMock.mockImplementationOnce(async () => false)
    await expect(isAutomationSessionActive(MANAGED, SESSION)).resolves.toBe(false)
  })

  test('throws MODULAR_SIGNER_ACTIVATION_FAILED when bytecode read fails', async () => {
    isContractDeployedMock.mockImplementationOnce(async () => {
      throw new Error('RPC timeout')
    })
    await expect(isAutomationSessionActive(MANAGED, SESSION)).rejects.toMatchObject({
      code: 'MODULAR_SIGNER_ACTIVATION_FAILED',
    })
    expect(readIsActiveSignerMock).not.toHaveBeenCalled()
  })

  test('throws when deployed and isActiveSigner returns empty 0x', async () => {
    readIsActiveSignerMock.mockImplementationOnce(async () => {
      throw new Error('Cannot decode zero data ("0x") — address is not a contract.')
    })
    await expect(isAutomationSessionActive(MANAGED, SESSION)).rejects.toMatchObject({
      code: 'MODULAR_SIGNER_ACTIVATION_FAILED',
    })
  })
})

describe('assertSessionKeyApprovesExecutor', () => {
  const withTargets = (approvedTargets: readonly Address[]) =>
    readPermissionsForSignerMock.mockImplementationOnce(async () => ({
      approvedTargets,
      nativeTokenLimitPerTransaction: 0n,
      startTimestamp: 0n,
      endTimestamp: 0n,
    }))

  test('passes a key approved for the executor, in any address case', async () => {
    withTargets([EXECUTOR.toLowerCase() as Address])
    await expect(assertSessionKeyApprovesExecutor(MANAGED, SESSION, EXECUTOR)).resolves.toBeUndefined()
  })

  test('passes a key approved for every target', async () => {
    withTargets([`0x${'0'.repeat(40)}`])
    await expect(assertSessionKeyApprovesExecutor(MANAGED, SESSION, EXECUTOR)).resolves.toBeUndefined()
  })

  test('refuses a key granted for a replaced executor and says how to fix it', async () => {
    withTargets([getAddress('0xcccccccccccccccccccccccccccccccccccccccc')])
    await expect(assertSessionKeyApprovesExecutor(MANAGED, SESSION, EXECUTOR)).rejects.toMatchObject({
      code: 'MODULAR_SIGNER_ACTIVATION_FAILED',
      message: expect.stringContaining('enrollPublishAutomation'),
    })
  })
})

import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { getAddress, type Address } from 'viem'
import { entryPoint06Address } from 'viem/account-abstraction'

const ACCOUNT = getAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
const ENTRY_POINT = getAddress('0xdddddddddddddddddddddddddddddddddddddddd')
const ONE_FINNEY = 10n ** 15n

let publishConfig: { maxAutomationExposureWei?: bigint } = {}
const isContractDeployedMock = mock(async () => true)
const readEthBalanceMock = mock(async () => 0n)
const readEntryPointDepositMock = mock(async (_entryPoint: Address) => 0n)

const config = await import('../config')
mock.module('../config', () => ({ ...config, getPublishConfig: () => publishConfig }))

const contracts = await import('./contracts')
mock.module('./contracts', () => ({
  ...contracts,
  readAccountEntryPoint: async () => ENTRY_POINT,
  readEthBalance: () => readEthBalanceMock(),
  readEntryPointDeposit: (entryPoint: Address) => readEntryPointDepositMock(entryPoint),
}))

mock.module('./chainClient', () => ({ isContractDeployed: () => isContractDeployedMock() }))

const { assertAutomationExposureAllowed, warnOnAutomationExposure } = await import('./automationExposure')

afterEach(() => {
  publishConfig = {}
  isContractDeployedMock.mockImplementation(async () => true)
  readEthBalanceMock.mockImplementation(async () => 0n)
  readEntryPointDepositMock.mockClear()
  readEntryPointDepositMock.mockImplementation(async () => 0n)
})

describe('assertAutomationExposureAllowed', () => {
  test('allows an empty account', async () => {
    await expect(assertAutomationExposureAllowed(ACCOUNT)).resolves.toBeUndefined()
  })

  test('allows exactly the default limit of 0.001 ETH', async () => {
    readEthBalanceMock.mockImplementation(async () => ONE_FINNEY)
    await expect(assertAutomationExposureAllowed(ACCOUNT)).resolves.toBeUndefined()
  })

  test('adds the balance and the deposit in the EntryPoint the account reports', async () => {
    readEthBalanceMock.mockImplementation(async () => ONE_FINNEY)
    readEntryPointDepositMock.mockImplementation(async () => 1n)
    await expect(assertAutomationExposureAllowed(ACCOUNT)).rejects.toMatchObject({
      code: 'AUTOMATION_ACCOUNT_FUNDED',
      message: expect.stringContaining('maxAutomationExposureWei'),
    })
    expect(readEntryPointDepositMock).toHaveBeenCalledWith(ENTRY_POINT)
  })

  test('reads an undeployed account against the v0.6 EntryPoint', async () => {
    isContractDeployedMock.mockImplementation(async () => false)
    readEntryPointDepositMock.mockImplementation(async () => ONE_FINNEY + 1n)
    await expect(assertAutomationExposureAllowed(ACCOUNT)).rejects.toMatchObject({
      code: 'AUTOMATION_ACCOUNT_FUNDED',
    })
    expect(readEntryPointDepositMock).toHaveBeenCalledWith(entryPoint06Address)
  })

  test('uses a configured limit, including zero', async () => {
    readEthBalanceMock.mockImplementation(async () => ONE_FINNEY * 2n)
    publishConfig = { maxAutomationExposureWei: ONE_FINNEY * 2n }
    await expect(assertAutomationExposureAllowed(ACCOUNT)).resolves.toBeUndefined()

    readEthBalanceMock.mockImplementation(async () => 1n)
    publishConfig = { maxAutomationExposureWei: 0n }
    await expect(assertAutomationExposureAllowed(ACCOUNT)).rejects.toMatchObject({
      code: 'AUTOMATION_ACCOUNT_FUNDED',
    })
  })

  test('refuses when the ETH can not be read', async () => {
    readEthBalanceMock.mockImplementation(async () => {
      throw new Error('RPC timeout')
    })
    await expect(assertAutomationExposureAllowed(ACCOUNT)).rejects.toMatchObject({
      code: 'MODULAR_SIGNER_ACTIVATION_FAILED',
    })
  })
})

describe('warnOnAutomationExposure', () => {
  test('warns over the limit and stays quiet under it', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    await warnOnAutomationExposure(ACCOUNT)
    expect(warn).not.toHaveBeenCalled()

    readEthBalanceMock.mockImplementation(async () => ONE_FINNEY + 1n)
    await warnOnAutomationExposure(ACCOUNT)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  test('does not fail when the ETH can not be read', async () => {
    readEthBalanceMock.mockImplementation(async () => {
      throw new Error('RPC timeout')
    })
    await expect(warnOnAutomationExposure(ACCOUNT)).resolves.toBeUndefined()
  })
})

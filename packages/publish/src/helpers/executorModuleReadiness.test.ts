import { afterEach, describe, expect, mock, test } from 'bun:test'
import { encodeErrorResult, HttpRequestError, RawContractError } from 'viem'
import { executorModuleAbi } from './abi/executor'

const MODULE = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const ACCOUNT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const EAS = '0x4200000000000000000000000000000000000021'

const isInitializedMock = mock(async () => true)
const moduleEasMock = mock(async () => EAS)
/** `getSeedExecutor()` on the account; null = no SeedExecutorRouterExtension. */
const routerMock = mock(async (): Promise<{ executor: string; eas: string } | null> => ({
  executor: MODULE,
  eas: EAS,
}))
const callMock = mock(async () => ({ data: '0x' }))

mock.module('../config', () => ({
  getPublishConfig: () => ({
    modularAccountModuleContract: MODULE,
    easContractAddress: EAS,
  }),
  setConfigRef: () => {},
  initPublish: () => {},
}))

mock.module('./contracts', () => ({
  readExecutorModuleIsInitialized: (...args: unknown[]) => isInitializedMock(...(args as [])),
  readExecutorModuleEas: (...args: unknown[]) => moduleEasMock(...(args as [])),
  readSeedExecutorRouter: (...args: unknown[]) => routerMock(...(args as [])),
}))

mock.module('./chainClient', () => ({
  getPublishPublicClient: () => ({ call: (...args: unknown[]) => callMock(...(args as [])) }),
}))

afterEach(() => {
  isInitializedMock.mockReset()
  isInitializedMock.mockImplementation(async () => true)
  moduleEasMock.mockReset()
  moduleEasMock.mockImplementation(async () => EAS)
  routerMock.mockReset()
  routerMock.mockImplementation(async () => ({ executor: MODULE, eas: EAS }))
  callMock.mockReset()
  callMock.mockImplementation(async () => ({ data: '0x' }))
})

describe('assertExecutorModuleReadyForAccount', () => {
  test('passes when the module is initialized for the account with the configured EAS', async () => {
    const { assertExecutorModuleReadyForAccount } = await import('./executorModuleReadiness')
    await expect(assertExecutorModuleReadyForAccount(ACCOUNT)).resolves.toBeUndefined()
  })

  test('names Router accounts without the executor router extension', async () => {
    isInitializedMock.mockImplementation(async () => false)
    routerMock.mockImplementation(async () => null)
    const { assertExecutorModuleReadyForAccount } = await import('./executorModuleReadiness')
    await expect(assertExecutorModuleReadyForAccount(ACCOUNT)).rejects.toMatchObject({
      code: 'AUTOMATION_UNSUPPORTED_ACCOUNT',
      message: expect.stringContaining('predates the Seed executor router extension'),
    })
  })

  test('tells Router accounts with the extension to install the executor', async () => {
    isInitializedMock.mockImplementation(async () => false)
    const { assertExecutorModuleReadyForAccount } = await import('./executorModuleReadiness')
    await expect(assertExecutorModuleReadyForAccount(ACCOUNT)).rejects.toMatchObject({
      code: 'AUTOMATION_UNSUPPORTED_ACCOUNT',
      message: expect.stringContaining('installSeedExecutor'),
    })
  })

  test('rejects when the module points at a different EAS', async () => {
    moduleEasMock.mockImplementation(async () => '0x0000000000000000000000000000000000000001')
    const { assertExecutorModuleReadyForAccount } = await import('./executorModuleReadiness')
    await expect(assertExecutorModuleReadyForAccount(ACCOUNT)).rejects.toMatchObject({
      code: 'AUTOMATION_UNSUPPORTED_ACCOUNT',
      message: expect.stringContaining('different EAS'),
    })
  })
})

describe('simulateCallFromAccount', () => {
  const tx = { to: MODULE as `0x${string}`, data: '0x2a29fadc' as `0x${string}` }

  test('simulates the call from the account', async () => {
    const { simulateCallFromAccount } = await import('./executorModuleReadiness')
    await simulateCallFromAccount({ managedAddress: ACCOUNT, tx, action: 'multiPublish' })
    expect(callMock).toHaveBeenCalledWith({
      account: ACCOUNT,
      to: MODULE,
      data: '0x2a29fadc',
      value: undefined,
    })
  })

  test('decodes executor module errors', async () => {
    const data = encodeErrorResult({
      abi: executorModuleAbi,
      errorName: 'NotInitialized',
      args: [ACCOUNT],
    })
    callMock.mockImplementation(async () => {
      throw new RawContractError({ data })
    })
    const { simulateCallFromAccount } = await import('./executorModuleReadiness')
    await expect(
      simulateCallFromAccount({ managedAddress: ACCOUNT, tx, action: 'multiPublish' }),
    ).rejects.toMatchObject({
      code: 'AUTOMATION_PREFLIGHT_FAILED',
      message: expect.stringMatching(/reverted with NotInitialized\(0xaaaa/i),
    })
  })

  test('explains a revert with no data', async () => {
    callMock.mockImplementation(async () => {
      throw new RawContractError({ message: 'execution reverted' })
    })
    const { simulateCallFromAccount } = await import('./executorModuleReadiness')
    await expect(
      simulateCallFromAccount({ managedAddress: ACCOUNT, tx, action: 'multiRevoke' }),
    ).rejects.toMatchObject({
      code: 'AUTOMATION_PREFLIGHT_FAILED',
      message: expect.stringContaining('reverted with no data'),
    })
  })

  test('fails closed when the simulation cannot run', async () => {
    callMock.mockImplementation(async () => {
      throw new HttpRequestError({ url: 'https://rpc.example', details: 'fetch failed' })
    })
    const { simulateCallFromAccount } = await import('./executorModuleReadiness')
    await expect(
      simulateCallFromAccount({ managedAddress: ACCOUNT, tx, action: 'multiPublish' }),
    ).rejects.toMatchObject({
      code: 'AUTOMATION_PREFLIGHT_FAILED',
      message: expect.stringContaining('could not be simulated'),
    })
  })
})

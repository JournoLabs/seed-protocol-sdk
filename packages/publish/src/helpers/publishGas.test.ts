import { afterEach, describe, expect, mock, test } from 'bun:test'
import { HttpRequestError } from 'viem'

const FROM = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const TX = { to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const, data: '0x1234' as const }

const estimateGas = mock(async (_args: { stateOverride?: unknown }) => 1_000_000n)
const getBlock = mock(async () => ({ gasLimit: 30_000_000n }))
mock.module('./chainClient', () => ({
  getPublishPublicClient: () => ({ estimateGas, getBlock }),
}))

const { publishGasLimit, PUBLISH_GAS_FALLBACK } = await import('./publishGas')

afterEach(() => {
  estimateGas.mockReset()
  estimateGas.mockImplementation(async () => 1_000_000n)
  getBlock.mockReset()
  getBlock.mockImplementation(async () => ({ gasLimit: 30_000_000n }))
})

describe('publishGasLimit', () => {
  test('the estimate from the sender, with 30% headroom', async () => {
    expect(await publishGasLimit(FROM, TX)).toBe(1_300_000n)
    expect(estimateGas.mock.calls[0]![0]).toMatchObject({ account: FROM, to: TX.to, data: TX.data })
  })

  test('an unfunded sender is estimated with a balance override', async () => {
    estimateGas.mockImplementationOnce(async () => {
      throw new Error('insufficient funds for gas * price + value')
    })
    expect(await publishGasLimit(FROM, TX)).toBe(1_300_000n)
    expect(estimateGas.mock.calls[1]![0].stateOverride).toBeDefined()
  })

  test('the fallback when the estimate cannot be made', async () => {
    estimateGas.mockImplementation(async () => {
      throw new HttpRequestError({ url: 'http://rpc' })
    })
    expect(await publishGasLimit(FROM, TX)).toBe(PUBLISH_GAS_FALLBACK)
  })

  test('refuses a publish that needs more gas than a block holds', async () => {
    estimateGas.mockImplementation(async () => 25_000_000n)
    await expect(publishGasLimit(FROM, TX)).rejects.toMatchObject({
      code: 'PUBLISH_TOO_LARGE',
      message: expect.stringContaining('more than a block holds (30000000)'),
    })
  })
})

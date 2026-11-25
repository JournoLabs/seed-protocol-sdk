import { afterEach, describe, expect, mock, test } from 'bun:test'
import { HttpRequestError } from 'viem'

const FROM = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const TX = { to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const, data: '0x1234' as const }

const estimateGas = mock(async (_args: { stateOverride?: unknown }) => 1_000_000n)
const getBlock = mock(async () => ({ gasLimit: 30_000_000n }))
const config = await import('../config')
mock.module('../config', () => ({ ...config, getPublishConfig: () => ({}) }))
mock.module('./chainClient', () => ({
  getPublishPublicClient: () => ({ estimateGas, getBlock }),
}))

const { estimatePublishGas, publishGasCeiling, publishGasLimit, PUBLISH_GAS_FALLBACK } = await import('./publishGas')
const { PUBLISH_MAX_GAS } = await import('./publishSize')

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

  test('passes the code override before delegation', async () => {
    const code = '0x6080604052' as const
    await publishGasLimit(FROM, TX, 0n, { codeOverride: code })
    expect(estimateGas.mock.calls[0]![0].stateOverride).toEqual([{ address: FROM, code }])

    estimateGas.mockClear()
    estimateGas.mockImplementationOnce(async () => {
      throw new Error('insufficient funds for gas * price + value')
    })
    expect(await estimatePublishGas(FROM, TX, { codeOverride: code })).toBe(1_300_000n)
    // One entry for the account: its balance and its code together.
    const retry = estimateGas.mock.calls[1]![0].stateOverride as Array<{ address: string; balance?: bigint; code?: string }>
    expect(retry).toHaveLength(1)
    expect(retry[0]).toMatchObject({ address: FROM, code })
    expect(retry[0]!.balance).toBeGreaterThan(0n)
  })

  // Split-publish review finding 8: this error was read as "no estimate" and sent with fallback gas.
  test('refuses a publish over the node gas cap instead of sending it with fallback gas', async () => {
    estimateGas.mockImplementation(async () => {
      throw new Error('gas required exceeds allowance (16777216)')
    })
    await expect(publishGasLimit(FROM, TX)).rejects.toMatchObject({ code: 'PUBLISH_TOO_LARGE' })
    expect(estimateGas.mock.calls[1]![0].stateOverride).toBeDefined()
  })

  test('an allowance error from a low balance is estimated again with a balance override', async () => {
    estimateGas.mockImplementationOnce(async () => {
      throw new Error('gas required exceeds allowance (21000)')
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

  test('a failed estimate uses the local estimate with headroom when it is above the fallback', async () => {
    estimateGas.mockImplementation(async () => {
      throw new HttpRequestError({ url: 'http://rpc' })
    })
    expect(await publishGasLimit(FROM, TX, 10_000_000n)).toBe(13_000_000n)
  })

  test('a failed estimate never goes above the limit', async () => {
    estimateGas.mockImplementation(async () => {
      throw new HttpRequestError({ url: 'http://rpc' })
    })
    expect(await publishGasLimit(FROM, TX, 15_000_000n)).toBe(PUBLISH_MAX_GAS)
  })

  // Batch 16 item 13
  test('a failed block read keeps the estimate, capped at the configured limit', async () => {
    getBlock.mockImplementation(async () => {
      throw new HttpRequestError({ url: 'http://rpc', details: 'fetch failed' })
    })
    expect(await publishGasLimit(FROM, TX)).toBe(1_300_000n)
  })

  test('refuses a publish over the default limit on a chain with bigger blocks', async () => {
    estimateGas.mockImplementation(async () => 13_000_000n)
    await expect(publishGasLimit(FROM, TX)).rejects.toMatchObject({
      code: 'PUBLISH_TOO_LARGE',
      message: expect.stringContaining('over the limit of 16000000'),
    })
  })

  test('refuses a publish that needs more gas than a block holds', async () => {
    estimateGas.mockImplementation(async () => 10_000_000n)
    getBlock.mockImplementation(async () => ({ gasLimit: 12_000_000n }))
    await expect(publishGasLimit(FROM, TX)).rejects.toMatchObject({
      code: 'PUBLISH_TOO_LARGE',
      message: expect.stringContaining('over the limit of 12000000'),
    })
  })
})

describe('publishGasCeiling', () => {
  test('publishGasCeiling is the lower of the config limit and the block limit', async () => {
    expect(await publishGasCeiling()).toBe(PUBLISH_MAX_GAS)
    getBlock.mockImplementation(async () => ({ gasLimit: 12_000_000n }))
    expect(await publishGasCeiling()).toBe(12_000_000n)
  })

  test('keeps the config limit when the block read fails', async () => {
    getBlock.mockImplementation(async () => {
      throw new HttpRequestError({ url: 'http://rpc', details: 'fetch failed' })
    })
    expect(await publishGasCeiling()).toBe(PUBLISH_MAX_GAS)
  })
})

import { afterAll, describe, expect, test } from 'bun:test'
import type { Hash } from 'viem'
import { bundlerFeesPerGas, CALL_GAS_HEADROOM_BPS, sendUserOpWithHeadroom, type UserOpClient } from './userOps'

let pimlicoAnswers = true
const methods: string[] = []
const bundler = Bun.serve({
  port: 0,
  fetch: async (req) => {
    const { id, method } = (await req.json()) as { id: number; method: string }
    methods.push(method)
    if (!pimlicoAnswers) {
      return Response.json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } })
    }
    return Response.json({
      jsonrpc: '2.0',
      id,
      result: {
        slow: { maxFeePerGas: '0x1', maxPriorityFeePerGas: '0x1' },
        standard: { maxFeePerGas: '0x2', maxPriorityFeePerGas: '0x2' },
        fast: { maxFeePerGas: '0x64', maxPriorityFeePerGas: '0xa' },
      },
    })
  },
})
const bundlerUrl = `http://127.0.0.1:${bundler.port}`
afterAll(() => {
  bundler.stop(true)
})

const chainFees = async () => ({ maxFeePerGas: 7n, maxPriorityFeePerGas: 3n })

describe('bundlerFeesPerGas', () => {
  test("uses the bundler's fast price when it answers pimlico_getUserOperationGasPrice", async () => {
    pimlicoAnswers = true
    await expect(bundlerFeesPerGas(bundlerUrl, chainFees)()).resolves.toEqual({
      maxFeePerGas: 100n,
      maxPriorityFeePerGas: 10n,
    })
  })

  test("falls back to the chain's estimate for a bundler without the method, and stops asking", async () => {
    pimlicoAnswers = false
    methods.length = 0
    const fees = bundlerFeesPerGas(bundlerUrl, chainFees)
    await expect(fees()).resolves.toEqual({ maxFeePerGas: 7n, maxPriorityFeePerGas: 3n })
    await expect(fees()).resolves.toEqual({ maxFeePerGas: 7n, maxPriorityFeePerGas: 3n })
    expect(methods).toEqual(['pimlico_getUserOperationGasPrice'])
  })
})

const TX_HASH = `0x${'cd'.repeat(32)}` as Hash
const TO = '0x1111111111111111111111111111111111111111' as const

function client(success = true) {
  const sent: Parameters<UserOpClient['sendUserOperation']>[0][] = []
  const c: UserOpClient = {
    estimateUserOperationGas: async () => ({
      callGasLimit: 100_000n,
      verificationGasLimit: 50_000n,
      preVerificationGas: 40_000n,
    }),
    sendUserOperation: async (args) => {
      sent.push(args)
      return `0x${'ab'.repeat(32)}` as Hash
    },
    waitForUserOperationReceipt: async () => ({ success, receipt: { transactionHash: TX_HASH } }),
  }
  return { c, sent }
}

describe('sendUserOpWithHeadroom', () => {
  test('sends the estimate with callGasLimit raised by the headroom', async () => {
    const { c, sent } = client()
    await expect(sendUserOpWithHeadroom(c, { to: TO, data: '0x1234' }, TO)).resolves.toBe(TX_HASH)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      calls: [{ to: TO, data: '0x1234', value: 0n }],
      callGasLimit: (100_000n * CALL_GAS_HEADROOM_BPS) / 10_000n,
      verificationGasLimit: 50_000n,
      preVerificationGas: 40_000n,
    })
  })

  test('a tx.gas above the raised estimate wins', async () => {
    const { c, sent } = client()
    await sendUserOpWithHeadroom(c, { to: TO, data: '0x', gas: 500_000n }, TO)
    expect(sent[0]!.callGasLimit).toBe(500_000n)
  })

  test('throws when the UserOp fails inside a successful bundle', async () => {
    const { c } = client(false)
    await expect(sendUserOpWithHeadroom(c, { to: TO, data: '0x' }, TO)).rejects.toMatchObject({
      code: 'USEROP_FAILED_NO_REASON',
    })
  })
})

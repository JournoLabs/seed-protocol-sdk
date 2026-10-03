import { afterAll, describe, expect, test } from 'bun:test'
import { entryPoint06Address, entryPoint08Address } from 'viem/account-abstraction'
import { encodeErrorResult } from 'viem'
import { seedErrorsAbi } from '../abi/seedErrors'
import { assertBundlerSupportsEntryPoint08, assertUserOpSucceeded } from './permissionlessTxSender'

let entryPoints: unknown = []
const server = Bun.serve({
  port: 0,
  fetch: () => Response.json({ jsonrpc: '2.0', id: 1, result: entryPoints }),
})
const url = `http://127.0.0.1:${server.port}`

afterAll(() => {
  server.stop(true)
})

describe('assertBundlerSupportsEntryPoint08', () => {
  test('rejects a v0.6-only bundler and points at thirdweb.bundlerUrl', async () => {
    entryPoints = [entryPoint06Address]
    await expect(assertBundlerSupportsEntryPoint08(url)).rejects.toThrow(/thirdweb\.bundlerUrl/)
  })

  test('accepts a bundler that lists v0.8', async () => {
    entryPoints = [entryPoint06Address, entryPoint08Address.toLowerCase()]
    await expect(assertBundlerSupportsEntryPoint08(url)).resolves.toBeUndefined()
  })

  test('lets through a bundler that does not answer eth_supportedEntryPoints', async () => {
    entryPoints = undefined
    await expect(assertBundlerSupportsEntryPoint08(url)).resolves.toBeUndefined()
    await expect(assertBundlerSupportsEntryPoint08('http://127.0.0.1:1')).resolves.toBeUndefined()
  })
})

describe('assertUserOpSucceeded', () => {
  const transactionHash = `0x${'cd'.repeat(32)}` as const

  test('returns the transaction hash of a successful UserOp', () => {
    expect(assertUserOpSucceeded({ success: true, receipt: { transactionHash } })).toBe(transactionHash)
  })

  test('throws for a failed UserOp even though the bundle transaction succeeded', () => {
    expect(() => assertUserOpSucceeded({ success: false, receipt: { transactionHash } })).toThrow(
      expect.objectContaining({
        code: 'USEROP_FAILED_NO_REASON',
        message: expect.stringContaining('ran out of gas'),
      }),
    )
  })

  test('decodes the revert reason', () => {
    const reason = encodeErrorResult({
      abi: seedErrorsAbi,
      errorName: 'Unauthorized',
      args: ['0x1111111111111111111111111111111111111111'],
    })
    expect(() => assertUserOpSucceeded({ success: false, reason, receipt: { transactionHash } })).toThrow(
      expect.objectContaining({
        code: 'USEROP_REVERTED',
        message: expect.stringMatching(/reverted with Unauthorized\(0x1111/),
      }),
    )
  })
})

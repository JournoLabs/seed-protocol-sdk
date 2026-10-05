import { afterEach, describe, expect, mock, test } from 'bun:test'

type Op = Record<string, any>
const calls: Array<{ fn: string; args: Record<string, any> }> = []
let paymasterResponses: Array<Record<string, any>> = []
let estimate = { callGasLimit: 2_220_008n, verificationGasLimit: 300_000n, preVerificationGas: 60_000n }

const realSmart = await import('thirdweb/wallets/smart')
mock.module('thirdweb/wallets/smart', () => ({
  ...realSmart,
  getPaymasterAndData: async (args: Record<string, any>) => {
    calls.push({ fn: 'paymaster', args: { ...args, userOp: { ...args.userOp } } })
    return paymasterResponses.shift() ?? { paymasterAndData: '0x' }
  },
  estimateUserOpGas: async (args: Record<string, any>) => {
    calls.push({ fn: 'estimate', args: { ...args, userOp: { ...args.userOp } } })
    return estimate
  },
}))

const { seedPaymaster, CALL_GAS_HEADROOM_BPS } = await import('./seedPaymaster')

const client = { clientId: 't' } as any
const chain = { id: 11155420, rpc: 'https://sepolia.optimism.io' } as any

function v06Op(overrides: Op = {}): Op {
  return {
    sender: '0x0000000000000000000000000000000000000001',
    nonce: 0n,
    initCode: '0x',
    callData: '0x1234',
    callGasLimit: 0n,
    verificationGasLimit: 0n,
    preVerificationGas: 0n,
    maxFeePerGas: 1n,
    maxPriorityFeePerGas: 1n,
    paymasterAndData: '0x',
    signature: '0x',
    ...overrides,
  }
}

afterEach(() => {
  calls.length = 0
  paymasterResponses = []
  estimate = { callGasLimit: 2_220_008n, verificationGasLimit: 300_000n, preVerificationGas: 60_000n }
})

describe('seedPaymaster', () => {
  test('sponsors, estimates, raises callGasLimit 1.2x, then has the paymaster sign the raised limits', async () => {
    paymasterResponses = [{ paymasterAndData: '0xaa' }, { paymasterAndData: '0xbb' }]
    const result = await seedPaymaster(() => client, chain, 'https://bundler.example')(v06Op() as any)

    expect(CALL_GAS_HEADROOM_BPS).toBe(12_000n)
    expect(calls.map((c) => c.fn)).toEqual(['paymaster', 'estimate', 'paymaster'])
    expect(calls[0]!.args).not.toHaveProperty('paymasterOverride')
    expect(calls[1]!.args.userOp.paymasterAndData).toBe('0xaa')
    expect(calls[1]!.args.options).toEqual({ client, chain, bundlerUrl: 'https://bundler.example' })
    expect(calls[2]!.args.userOp).toMatchObject({
      callGasLimit: 2_664_009n,
      verificationGasLimit: 300_000n,
      preVerificationGas: 60_000n,
    })
    expect(result).toEqual({
      paymasterAndData: '0xbb',
      callGasLimit: 2_664_009n,
      verificationGasLimit: 300_000n,
      preVerificationGas: 60_000n,
    })
  })

  test('a tx.gas above the raised estimate wins', async () => {
    const result = await seedPaymaster(() => client, chain)(v06Op({ callGasLimit: 3_000_000n }) as any)
    expect(result.callGasLimit).toBe(3_000_000n)
  })

  test('a tx.gas below the raised estimate is ignored', async () => {
    const result = await seedPaymaster(() => client, chain)(v06Op({ callGasLimit: 1_000_000n }) as any)
    expect(result.callGasLimit).toBe(2_664_009n)
  })

  test('returns the paymaster limits when its signature covers its own', async () => {
    const own = {
      paymasterAndData: '0xcc',
      callGasLimit: 2_500_000n,
      verificationGasLimit: 310_000n,
      preVerificationGas: 61_000n,
    }
    paymasterResponses = [{ paymasterAndData: '0xaa' }, own]
    const result = await seedPaymaster(() => client, chain)(v06Op() as any)
    expect(result).toEqual(own)
  })

  test('looks up the client per UserOp, not when the hook is built', async () => {
    let lookups = 0
    const hook = seedPaymaster(() => (lookups++, client), chain)
    expect(lookups).toBe(0)
    await hook(v06Op() as any)
    expect(lookups).toBe(1)
  })

  test('accepts a client object as well as a getter', async () => {
    await seedPaymaster(client, chain)(v06Op() as any)
    expect(calls[0]!.args.client).toBe(client)
    expect(calls[1]!.args.options.client).toBe(client)
  })

  test('rejects an EntryPoint v0.7 UserOp', async () => {
    const { initCode: _initCode, paymasterAndData: _pad, ...rest } = v06Op()
    const v07 = { ...rest, factory: undefined, factoryData: '0x', paymasterData: '0x' }
    await expect(seedPaymaster(() => client, chain)(v07 as any)).rejects.toThrow(/EntryPoint v0\.7/)
    expect(calls).toHaveLength(0)
  })
})

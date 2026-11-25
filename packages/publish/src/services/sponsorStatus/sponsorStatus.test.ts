import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { entryPoint08Address } from 'viem/account-abstraction'

const PAYMASTER = '0x' + '9'.repeat(40)
let config: Record<string, unknown> = {}
const reads: Array<{ address: string; functionName: string; args: unknown[] }> = []

const realConfig = await import('~/config')
const realChainClient = await import('~/helpers/chainClient')
mock.module('~/config', () => ({ ...realConfig, getPublishConfig: () => config }))
mock.module('~/helpers/chainClient', () => ({
  ...realChainClient,
  getPublishPublicClient: () => ({
    readContract: async (args: { address: string; functionName: string; args: unknown[] }) => {
      reads.push(args)
      return 123n
    },
  }),
}))

const { getSponsorStatus } = await import('./sponsorStatus')

beforeEach(() => {
  reads.length = 0
})

describe('getSponsorStatus', () => {
  test('reads the v0.8 EntryPoint deposit', async () => {
    config = { bundlerUrl: 'http://b', paymasterUrl: 'http://p', payment: { sponsorPaymaster: PAYMASTER } }
    expect(await getSponsorStatus()).toEqual({ paymaster: PAYMASTER, depositWei: 123n })
    expect(reads).toHaveLength(1)
    expect(reads[0]!.address).toBe(entryPoint08Address)
    expect(reads[0]!.functionName).toBe('balanceOf')
    expect(reads[0]!.args).toEqual([PAYMASTER])
  })

  test('null without sponsorPaymaster', async () => {
    config = { bundlerUrl: 'http://b', paymasterUrl: 'http://p', payment: {} }
    expect(await getSponsorStatus()).toBeNull()
    expect(reads).toHaveLength(0)
  })
})

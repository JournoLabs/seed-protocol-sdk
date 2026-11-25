import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import type { Address } from 'viem'
import { setConfigRef, type PublishConfig } from '../config'
import * as chainClient from './chainClient'
import * as contracts from './contracts'
import { SIMPLE_7702_ACCOUNT_ADDRESS } from './constants'
import { assertSeedDelegateEas, resetSeedDelegateEasCache, sendsThroughSeedDelegate } from './seedDelegate'

const EOA = `0x${'e'.repeat(40)}`
const DELEGATE = `0x${'5e'.repeat(20)}` as Address
const OP_EAS = '0x4200000000000000000000000000000000000021'
const designator = (to: string) => `0xef0100${to.slice(2).toLowerCase()}`

let code: string | undefined
let codeReads = 0
const seedSender = { delegatesTo: DELEGATE }

const spies: { mockRestore: () => void }[] = []
beforeEach(() => {
  code = undefined
  codeReads = 0
  resetSeedDelegateEasCache()
  spies.push(
    spyOn(chainClient, 'getPublishPublicClient').mockImplementation(
      () =>
        ({
          getCode: async () => {
            codeReads++
            return code
          },
        }) as never,
    ),
  )
})
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore()
  setConfigRef(null)
})

const setCfg = (partial: Partial<PublishConfig> = {}) =>
  setConfigRef({
    uploadApiBaseUrl: 'https://example.com',
    rpcUrl: 'https://rpc.invalid',
    accountMode: 'eip7702',
    seedDelegateAddress: DELEGATE,
    ...partial,
  })

describe('sendsThroughSeedDelegate', () => {
  test('an EOA delegated to the Seed delegate is delegated', async () => {
    setCfg()
    code = designator(DELEGATE)
    expect(await sendsThroughSeedDelegate(EOA, undefined)).toBe('delegated')
  })

  test('an EOA with no code will delegate when its sender authorizes the Seed delegate', async () => {
    setCfg()
    expect(await sendsThroughSeedDelegate(EOA, seedSender)).toBe('will_delegate')
  })

  test('an EOA on Simple7702Account will move to the Seed delegate', async () => {
    setCfg()
    code = designator(SIMPLE_7702_ACCOUNT_ADDRESS)
    expect(await sendsThroughSeedDelegate(EOA, seedSender)).toBe('will_delegate')
  })

  test("a sender that won't delegate (a plain EOA sender) keeps the EOA off the route", async () => {
    setCfg()
    expect(await sendsThroughSeedDelegate(EOA, {})).toBe(false)
    expect(await sendsThroughSeedDelegate(EOA, undefined)).toBe(false)
  })

  test('will_delegate needs accountMode eip7702', async () => {
    setCfg({ accountMode: 'eoa' })
    expect(await sendsThroughSeedDelegate(EOA, seedSender)).toBe(false)
  })

  test('an EOA delegated to a wallet vendor is not on the route', async () => {
    setCfg()
    code = designator(`0x${'b'.repeat(40)}`)
    expect(await sendsThroughSeedDelegate(EOA, seedSender)).toBe(false)
  })

  test('a contract is not on the route', async () => {
    setCfg()
    code = '0x6080604052'
    expect(await sendsThroughSeedDelegate(EOA, seedSender)).toBe(false)
  })

  test('without a delegate configured it is false, with no RPC read', async () => {
    setCfg({ seedDelegateAddress: undefined, chain: undefined })
    code = designator(DELEGATE)
    expect(await sendsThroughSeedDelegate(EOA, seedSender)).toBe(false)
    expect(codeReads).toBe(0)
  })
})

describe('assertSeedDelegateEas', () => {
  test('passes when the delegate uses the configured EAS', async () => {
    setCfg()
    spies.push(spyOn(contracts, 'readGetEas').mockImplementation(async () => OP_EAS as Address))
    await expect(assertSeedDelegateEas(DELEGATE)).resolves.toBeUndefined()
  })

  test('throws PUBLISH_PREFLIGHT_FAILED when its EAS differs', async () => {
    setCfg()
    spies.push(spyOn(contracts, 'readGetEas').mockImplementation(async () => `0x${'ea'.repeat(20)}` as Address))
    await expect(assertSeedDelegateEas(DELEGATE)).rejects.toMatchObject({
      code: 'PUBLISH_PREFLIGHT_FAILED',
      message: expect.stringContaining(`0x${'ea'.repeat(20)}`),
    })
  })

  test("throws PUBLISH_PREFLIGHT_FAILED when its EAS can't be read", async () => {
    setCfg()
    spies.push(
      spyOn(contracts, 'readGetEas').mockImplementation(async () => {
        throw new Error('execution reverted')
      }),
    )
    await expect(assertSeedDelegateEas(DELEGATE)).rejects.toMatchObject({ code: 'PUBLISH_PREFLIGHT_FAILED' })
  })

  test('reads once per delegate and EAS', async () => {
    setCfg()
    const read = spyOn(contracts, 'readGetEas').mockImplementation(async () => OP_EAS as Address)
    spies.push(read)
    await assertSeedDelegateEas(DELEGATE)
    await assertSeedDelegateEas(DELEGATE)
    expect(read).toHaveBeenCalledTimes(1)
  })
})

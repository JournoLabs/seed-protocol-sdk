import { afterEach, describe, expect, mock, test } from 'bun:test'

const FROM = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const SEED = `0x${'11'.repeat(32)}`
const ZERO = `0x${'0'.repeat(64)}`

let publishConfig: { maxPublishGas?: bigint } = {}
const config = await import('../config')
mock.module('../config', () => ({ ...config, getPublishConfig: () => publishConfig }))

const { assertPublishFits, localPublishGas } = await import('./publishSize')

const bytes = (n: number) => `0x${'ab'.repeat(n)}`
const request = (localId: string, n: number, seedUid = SEED) => ({
  localId,
  seedUid,
  listOfAttestations: [{ data: [{ data: bytes(n) }] }],
})

afterEach(() => {
  publishConfig = {}
})

describe('localPublishGas', () => {
  test('counts 710 gas per attested byte and 350k per new seed', () => {
    expect(localPublishGas([request('a', 1_000)])).toBe(710_000n)
    expect(localPublishGas([request('a', 1_000, ZERO)])).toBe(1_060_000n)
  })

  test('leaves out new seeds for a transaction of properties only', () => {
    expect(localPublishGas([request('a', 1_000, ZERO)], { newPairs: false })).toBe(710_000n)
  })
})

describe('assertPublishFits', () => {
  test('passes a publish at the limit', () => {
    const fits = request('a', Math.floor(16_000_000 / 710))
    expect(() => assertPublishFits(FROM, [fits])).not.toThrow()
  })

  test('refuses attested data over the gas limit and names the largest requests', () => {
    const requests = [request('small', 10), request('big', 30_000), request('mid', 100), request('tiny', 1)]
    expect(() => assertPublishFits(FROM, requests)).toThrow(
      expect.objectContaining({
        code: 'PUBLISH_TOO_LARGE',
        message: expect.stringContaining('Largest: big (30000 bytes), mid (100 bytes), small (10 bytes)'),
      }),
    )
  })

  test('refuses too many new seeds', () => {
    const requests = Array.from({ length: 46 }, (_, i) => request(`r${i}`, 1, ZERO))
    expect(() => assertPublishFits(FROM, requests)).toThrow(expect.objectContaining({ code: 'PUBLISH_TOO_LARGE' }))
  })

  test('refuses calldata over 120,000 bytes', () => {
    expect(() => assertPublishFits(FROM, [request('a', 1)], { calldata: bytes(120_001) as `0x${string}` })).toThrow(
      expect.objectContaining({
        code: 'PUBLISH_TOO_LARGE',
        message: expect.stringContaining('120001 bytes of calldata'),
      }),
    )
  })

  test('takes the limit from maxPublishGas', () => {
    publishConfig = { maxPublishGas: 1_000n }
    expect(() => assertPublishFits(FROM, [request('a', 1)])).not.toThrow()
    expect(() => assertPublishFits(FROM, [request('a', 2)])).toThrow(
      expect.objectContaining({ code: 'PUBLISH_TOO_LARGE' }),
    )
  })
})

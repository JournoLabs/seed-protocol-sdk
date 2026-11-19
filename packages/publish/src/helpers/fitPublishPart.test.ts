import { describe, expect, mock, test } from 'bun:test'
import type { MultiPublishRequest } from './contracts'

const config = await import('../config')
mock.module('../config', () => ({ ...config, getPublishConfig: () => ({}) }))

const { fitPublishPart, publishUnits } = await import('./publishParts')

const b32 = (byte: string) => `0x${byte.repeat(32)}` as `0x${string}`
const request = (localId: string): MultiPublishRequest => ({
  localId,
  seedUid: b32('00'),
  seedSchemaUid: b32('02'),
  versionUid: b32('00'),
  versionSchemaUid: b32('04'),
  seedIsRevocable: true,
  listOfAttestations: [],
  propertiesToUpdate: [],
})
/** Eight independent seeds: well inside the local estimate at the default limit. */
const units = publishUnits(Array.from({ length: 8 }, (_, i) => request(`r${i}`)))

describe('fitPublishPart', () => {
  test('bisects to the longest prefix the estimate accepts', async () => {
    const estimate = mock(async (requests: MultiPublishRequest[]) => BigInt(requests.length) * 2_000_000n)
    expect(await fitPublishPart(units, estimate, 10_000_000n)).toBe(5)
    expect(estimate.mock.calls.length).toBeLessThanOrEqual(4)
  })

  test('an estimate that cannot be made keeps the local prefix', async () => {
    expect(await fitPublishPart(units, async () => undefined, 10_000_000n)).toBe(8)
  })

  test('one unit over the ceiling refuses', async () => {
    await expect(fitPublishPart(units, async () => 20_000_000n, 10_000_000n)).rejects.toMatchObject({
      code: 'PUBLISH_TOO_LARGE',
      message: expect.stringContaining('Item r0 is too large'),
    })
  })
})

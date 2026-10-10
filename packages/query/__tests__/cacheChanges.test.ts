import { describe, expect, it, vi } from 'vitest'
import {
  CHANGE_CHECK_OVERLAP_SECONDS,
  checkWindowAged,
  checkedAtFor,
  findChangedSeeds,
} from '../src/cache/changes.js'
import type { QueryDataSource } from '../src/source/types.js'
import type { AttestationChange } from '../src/types.js'

const sourceWithChanges = (changes: AttestationChange[]) =>
  ({
    kind: 'remote',
    listChangesSince: vi.fn().mockResolvedValue(changes),
  }) as unknown as QueryDataSource & { listChangesSince: ReturnType<typeof vi.fn> }

const deps = new Map([
  // post A relates to image I (head version vI)
  ['0xA', { refUIDs: ['0xA', '0xvA', '0xI', '0xvI'], ids: ['0xA', '0xI'] }],
  ['0xB', { refUIDs: ['0xB', '0xvB'], ids: ['0xB'] }],
])

const change = (id: string, refUID: string, revocationTime = 0): AttestationChange => ({
  id,
  refUID,
  timeCreated: 1000,
  revocationTime,
})

describe('findChangedSeeds', () => {
  it('asks for changes on every dependency since checkedAt', async () => {
    const source = sourceWithChanges([])
    await findChangedSeeds(source, deps, { checkedAt: 500, seenChangeKeys: [] })
    expect(source.listChangesSince).toHaveBeenCalledWith({
      refUIDs: ['0xA', '0xvA', '0xI', '0xvI', '0xB', '0xvB'],
      ids: ['0xA', '0xI', '0xB'],
      since: 500,
    })
  })

  it('maps a change back to every seed that depends on it', async () => {
    const found = await findChangedSeeds(
      sourceWithChanges([
        change('0xprop', '0xvI'), // property on the related image's head version
        change('0xvB2', '0xB'), // new version of B
      ]),
      deps,
      { checkedAt: 500, seenChangeKeys: [] },
    )
    expect([...found!.changed].sort()).toEqual(['0xA', '0xB'])
  })

  it('sees a revoked related seed by its id', async () => {
    const found = await findChangedSeeds(
      sourceWithChanges([change('0xI', '0x0', 1200)]),
      deps,
      { checkedAt: 500, seenChangeKeys: [] },
    )
    expect([...found!.changed]).toEqual(['0xA'])
  })

  it('skips changes already seen, but not the same attestation revoked since', async () => {
    const seen = [`0xprop:0`]
    const unchanged = await findChangedSeeds(
      sourceWithChanges([change('0xprop', '0xvA')]),
      deps,
      { checkedAt: 500, seenChangeKeys: seen },
    )
    expect(unchanged!.changed.size).toBe(0)

    const revoked = await findChangedSeeds(
      sourceWithChanges([change('0xprop', '0xvA', 1300)]),
      deps,
      { checkedAt: 500, seenChangeKeys: seen },
    )
    expect([...revoked!.changed]).toEqual(['0xA'])
    expect(revoked!.seenChangeKeys).toEqual(['0xprop:1300'])
  })

  it('returns null when the source cannot list changes', async () => {
    const source = { kind: 'remote' } as unknown as QueryDataSource
    expect(await findChangedSeeds(source, deps, { checkedAt: 0, seenChangeKeys: [] })).toBeNull()
  })
})

describe('change check window', () => {
  it('overlaps the previous check and ages after twice the overlap', () => {
    expect(checkedAtFor(10_000)).toBe(10_000 - CHANGE_CHECK_OVERLAP_SECONDS)
    const check = { checkedAt: checkedAtFor(10_000), seenChangeKeys: [] }
    expect(checkWindowAged(check, 10_000 + CHANGE_CHECK_OVERLAP_SECONDS)).toBe(false)
    expect(checkWindowAged(check, 10_000 + CHANGE_CHECK_OVERLAP_SECONDS + 1)).toBe(true)
  })
})

import { describe, expect, it, vi } from 'vitest'
import {
  CHANGE_CHECK_OVERLAP_SECONDS,
  checkWindowAged,
  checkedAtFor,
  findChangedItems,
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

describe('findChangedItems', () => {
  const checks = new Map([
    ['0xA', { dependencies: deps.get('0xA')!, checkedAt: 500, seenChangeKeys: ['0xseen:0'] }],
    ['0xB', { dependencies: deps.get('0xB')!, checkedAt: 900, seenChangeKeys: [] }],
  ])

  it('asks once, from the oldest check', async () => {
    const source = sourceWithChanges([])
    await findChangedItems(source, checks)
    expect(source.listChangesSince).toHaveBeenCalledTimes(1)
    expect(source.listChangesSince.mock.calls[0]![0].since).toBe(500)
  })

  it("counts a change only for items checked before it, and skips each item's seen keys", async () => {
    const found = await findChangedItems(
      sourceWithChanges([
        { ...change('0xvB2', '0xB'), timeCreated: 800 }, // before B's check
        { ...change('0xseen', '0xvA'), timeCreated: 600 }, // seen by A
        { ...change('0xvI2', '0xI'), timeCreated: 700 }, // new version of A's related image
      ]),
      checks,
    )
    expect([...found!.changed]).toEqual(['0xA'])
    expect(found!.seenChangeKeys.get('0xA')).toEqual(['0xseen:0', '0xvI2:0'])
    expect(found!.seenChangeKeys.get('0xB')).toEqual([])
  })

  it('returns null when the source cannot list changes', async () => {
    const source = { kind: 'remote' } as unknown as QueryDataSource
    expect(await findChangedItems(source, checks)).toBeNull()
  })
})

describe('pair half dependencies', () => {
  const SCHEMA = '0xinclusion'
  const pairDeps = new Map([
    ['0xP', { refUIDs: [], ids: ['0xP'], halves: { schemaIds: [SCHEMA], addresses: ['0xowner'] } }],
    ['0xA', deps.get('0xA')!],
  ])
  const half = (fields: Partial<AttestationChange>): AttestationChange => ({
    ...change('0xhalf', '0x0'),
    schemaId: SCHEMA,
    ...fields,
  })

  it('asks for halves by or addressed to the dependency addresses', async () => {
    const source = sourceWithChanges([])
    await findChangedSeeds(source, pairDeps, { checkedAt: 500, seenChangeKeys: [] })
    expect(source.listChangesSince.mock.calls[0]![0].halves).toEqual({ schemaIds: [SCHEMA], addresses: ['0xowner'] })
  })

  it('sees a new half by its attester or its recipient, but not one of another schema', async () => {
    for (const fields of [{ attester: '0xOWNER' }, { recipient: '0xowner' }]) {
      const found = await findChangedSeeds(sourceWithChanges([half(fields)]), pairDeps, { checkedAt: 500, seenChangeKeys: [] })
      expect([...found!.changed]).toEqual(['0xP'])
    }
    const other = await findChangedSeeds(
      sourceWithChanges([half({ attester: '0xowner', schemaId: '0xstaff' })]),
      pairDeps,
      { checkedAt: 500, seenChangeKeys: [] },
    )
    expect(other!.changed.size).toBe(0)
  })

  it('sees a revoked half for an item', async () => {
    const found = await findChangedItems(
      sourceWithChanges([half({ recipient: '0xowner', revocationTime: 1200 })]),
      new Map([['0xP', { dependencies: pairDeps.get('0xP')!, checkedAt: 1100, seenChangeKeys: [] }]]),
    )
    expect([...found!.changed]).toEqual(['0xP'])
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

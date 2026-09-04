import { describe, it, expect } from 'vitest'
import {
  applyChangelogFilters,
  buildFlatSnapshotFromProperties,
  decodePropertyAttestation,
  diffPropertyAttestations,
  diffVersionSnapshots,
} from '../src/changelog.js'
import { buildAssembleOptionsKey } from '../src/cache/types.js'
import type { AttestationLike, ChangelogEntry } from '../src/types.js'

function propAttestation(opts: {
  id: string
  refUID: string
  schemaId: string
  timeCreated: number
  name: string
  value: string | string[]
  type?: string
}): AttestationLike {
  return {
    id: opts.id,
    refUID: opts.refUID,
    schemaId: opts.schemaId,
    timeCreated: opts.timeCreated,
    decodedDataJson: JSON.stringify([
      {
        value: {
          name: opts.name,
          value: opts.value,
          type: opts.type ?? 'string',
        },
      },
    ]),
  }
}

describe('decodePropertyAttestation / buildFlatSnapshotFromProperties', () => {
  it('decodes title into snake and leaves camel same', () => {
    const att = propAttestation({
      id: 'p1',
      refUID: 'v1',
      schemaId: 'sTitle',
      timeCreated: 10,
      name: 'title',
      value: 'Hello',
    })
    const decoded = decodePropertyAttestation(att)
    expect(decoded).toEqual({
      propertyName: 'title',
      value: 'Hello',
      camelName: undefined,
    })
  })

  it('builds flat snapshot with camel alias for snake_case names', () => {
    const props = [
      propAttestation({
        id: 'p1',
        refUID: 'v1',
        schemaId: 'sTitle',
        timeCreated: 10,
        name: 'storage_transaction_id',
        value: 'tx123',
      }),
    ]
    const snap = buildFlatSnapshotFromProperties(props)
    expect(snap.storage_transaction_id).toBe('tx123')
    expect(snap.storageTransactionId).toBe('tx123')
  })
})

describe('diffVersionSnapshots', () => {
  it('emits empty before for first version and all keys changed', () => {
    const entries = diffVersionSnapshots([
      { versionUid: 'v1', at: 100, data: { title: 'A' } },
    ])
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      type: 'version',
      versionUid: 'v1',
      at: 100,
      before: {},
      after: { title: 'A' },
      changedKeys: ['title'],
    })
  })

  it('diffs consecutive versions with changedKeys', () => {
    const entries = diffVersionSnapshots([
      { versionUid: 'v1', at: 100, data: { title: 'A', body: 'x' } },
      { versionUid: 'v2', at: 200, data: { title: 'B', body: 'x' } },
      {
        versionUid: 'v3',
        at: 300,
        data: { title: 'B', body: 'y', tag: 'new' },
      },
    ])
    expect(entries).toHaveLength(3)
    expect(entries[1]!.changedKeys).toEqual(['title'])
    expect(entries[1]!.before.title).toBe('A')
    expect(entries[1]!.after.title).toBe('B')
    expect(entries[2]!.changedKeys).toEqual(['body', 'tag'])
  })
})

describe('diffPropertyAttestations', () => {
  it('emits one entry per property update ordered by time', () => {
    const props = [
      propAttestation({
        id: 'a1',
        refUID: 'v1',
        schemaId: 'sTitle',
        timeCreated: 10,
        name: 'title',
        value: 'A',
      }),
      propAttestation({
        id: 'a2',
        refUID: 'v1',
        schemaId: 'sBody',
        timeCreated: 20,
        name: 'body',
        value: 'B',
      }),
      propAttestation({
        id: 'a3',
        refUID: 'v2',
        schemaId: 'sTitle',
        timeCreated: 30,
        name: 'title',
        value: 'C',
      }),
    ]
    const entries = diffPropertyAttestations(props)
    expect(entries).toHaveLength(3)
    expect(entries[0]).toMatchObject({
      type: 'property',
      property: 'title',
      previousValue: undefined,
      nextValue: 'A',
      versionUid: 'v1',
    })
    expect(entries[1]).toMatchObject({
      property: 'body',
      nextValue: 'B',
    })
    expect(entries[2]).toMatchObject({
      property: 'title',
      previousValue: 'A',
      nextValue: 'C',
      versionUid: 'v2',
    })
  })
})

describe('applyChangelogFilters', () => {
  const entries: ChangelogEntry[] = [
    {
      type: 'version',
      at: 100,
      versionUid: 'v1',
      before: {},
      after: { title: 'A' },
      changedKeys: ['title'],
    },
    {
      type: 'version',
      at: 200,
      versionUid: 'v2',
      before: { title: 'A' },
      after: { title: 'B' },
      changedKeys: ['title'],
    },
    {
      type: 'version',
      at: 300,
      versionUid: 'v3',
      before: { title: 'B' },
      after: { title: 'C' },
      changedKeys: ['title'],
    },
  ]

  it('filters by since inclusive', () => {
    const out = applyChangelogFilters(entries, { since: 200 })
    expect(out.map((e) => e.versionUid)).toEqual(['v2', 'v3'])
  })

  it('keeps newest limit entries in chronological order', () => {
    const out = applyChangelogFilters(entries, { limit: 2 })
    expect(out.map((e) => e.versionUid)).toEqual(['v2', 'v3'])
  })

  it('combines since and limit', () => {
    const out = applyChangelogFilters(entries, { since: 100, limit: 1 })
    expect(out.map((e) => e.versionUid)).toEqual(['v3'])
  })
})

describe('buildAssembleOptionsKey changelog fingerprint', () => {
  it('preserves e1-h1 for default data include', () => {
    expect(buildAssembleOptionsKey()).toBe('e1-h1')
    expect(buildAssembleOptionsKey({ include: 'data' })).toBe('e1-h1')
    expect(buildAssembleOptionsKey({ include: 'data', changelog: {} })).toBe(
      'e1-h1',
    )
  })

  it('isolates data+changelog from data-only', () => {
    const withCl = buildAssembleOptionsKey({
      include: 'data+changelog',
    })
    expect(withCl).toBe('e1-h1-i1-gv-s0-l0')
    expect(withCl).not.toBe(buildAssembleOptionsKey())
  })

  it('encodes property granularity, since, limit', () => {
    expect(
      buildAssembleOptionsKey({
        include: 'changelog',
        expandRelations: false,
        hydrateStorage: false,
        changelog: {
          granularity: 'property',
          since: 1700000000,
          limit: 50,
        },
      }),
    ).toBe('e0-h0-i2-gp-s1700000000-l50')
  })
})

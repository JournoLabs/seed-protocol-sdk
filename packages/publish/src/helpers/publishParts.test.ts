import { afterEach, describe, expect, mock, test } from 'bun:test'
import { encodeAbiParameters, stringToHex } from 'viem'
import type { MultiPublishRequest } from './contracts'

let publishConfig: { maxPublishGas?: bigint } = {}
const config = await import('../config')
mock.module('../config', () => ({ ...config, getPublishConfig: () => publishConfig }))

const { expectedPartCount, localPrefixLength, partRequests, publishUnits } = await import('./publishParts')

const b32 = (byte: string) => `0x${byte.repeat(32)}` as `0x${string}`
const ZERO = b32('00')
const RELATION = b32('05')
const LIST = b32('06')

type Reference = MultiPublishRequest['propertiesToUpdate'][number]
type Attestation = MultiPublishRequest['listOfAttestations'][number]

const attestation = (schema: `0x${string}`, easType: string, data: `0x${string}`): Attestation => ({
  schema,
  _easType: easType,
  data: [{ recipient: '0x0000000000000000000000000000000000000000', expirationTime: 0n, revocable: true, refUID: ZERO, data, value: 0n }],
})
/** A relation to a draft, as getPublishPayload encodes it: the draft's local id. */
const relation = (localId: string) => attestation(RELATION, 'bytes32', stringToHex(localId, { size: 32 }))
const list = (...localIds: string[]) =>
  attestation(LIST, 'bytes32[]', encodeAbiParameters([{ type: 'bytes32[]' }], [localIds.map((id) => stringToHex(id, { size: 32 }))]))

/** A request that creates its seed (350,000 gas each in the local estimate). */
function request(localId: string, references: Reference[] = [], attestations: Attestation[] = []): MultiPublishRequest {
  return {
    localId,
    seedUid: ZERO,
    seedSchemaUid: b32('02'),
    versionUid: ZERO,
    versionSchemaUid: b32('04'),
    seedIsRevocable: true,
    listOfAttestations: attestations,
    propertiesToUpdate: references,
  }
}
const fills = (publishLocalId: string, schema = RELATION, elementIndex?: number): Reference => ({
  publishLocalId,
  propertySchemaUid: schema,
  ...(elementIndex === undefined ? {} : { listElement: true, elementIndex }),
})
const ids = (units: MultiPublishRequest[][]) => units.map((u) => u.map((r) => r.localId))

afterEach(() => {
  publishConfig = {}
})

describe('publishUnits', () => {
  test('a chain of three is three units, referenced first', () => {
    // C references B and B references A: A fills B's slot, B fills C's.
    const c = request('c', [], [relation('b')])
    const b = request('b', [fills('c')], [relation('a')])
    const a = request('a', [fills('b')])
    expect(ids(publishUnits([c, b, a]))).toEqual([['a'], ['b'], ['c']])
  })

  test('a cycle is one unit even when it arrives last', () => {
    // X and Y reference each other and R references X; orderPayloadByDependencies can't order the
    // cycle, so it appends X and Y after R.
    const r = request('r', [], [relation('x')])
    const x = request('x', [fills('y'), fills('r')], [relation('y')])
    const y = request('y', [fills('x')], [relation('x')])
    expect(ids(publishUnits([r, x, y]))).toEqual([['x', 'y'], ['r']])
  })

  test('a list element reference orders its source first', () => {
    const post = request('post', [], [list('a1', 'a2')])
    const a1 = request('a1', [fills('post', LIST, 0)])
    const a2 = request('a2', [fills('post', LIST, 1)])
    expect(ids(publishUnits([post, a1, a2]))).toEqual([['a1'], ['a2'], ['post']])
  })
})

describe('partRequests', () => {
  test('a reference into a later part is dropped from the earlier part', () => {
    const a = request('a', [fills('b')])
    const b = request('b', [], [relation('a')])
    const units = publishUnits([a, b])
    const part = partRequests(units, 1)
    expect(part.map((r) => r.localId)).toEqual(['a'])
    expect(part[0]!.propertiesToUpdate).toEqual([])
    expect(a.propertiesToUpdate).toEqual([fills('b')])
    expect(partRequests(units, 2)[0]!.propertiesToUpdate).toEqual([fills('b')])
  })
})

describe('localPrefixLength', () => {
  test('the local cut stops before the unit that would exceed the limit', () => {
    // Forces a cut at small sizes; the default limit (16M) holds 35 such seeds.
    publishConfig = { maxPublishGas: 1_000_000n }
    const units = publishUnits(['a', 'b', 'c', 'd', 'e'].map((id) => request(id)))
    // 2 × 350,000 × 1.3 = 910,000 fits; 3 would be 1,365,000.
    expect(localPrefixLength(units)).toBe(2)
  })
})

describe('expectedPartCount', () => {
  test('expectedPartCount for five seeds at that limit is 3', () => {
    // Forces a cut at small sizes.
    publishConfig = { maxPublishGas: 1_000_000n }
    expect(expectedPartCount(['a', 'b', 'c', 'd', 'e'].map((id) => request(id)))).toBe(3)
  })

  test('a graph that fits is one part at the default limit', () => {
    expect(expectedPartCount(['a', 'b', 'c', 'd', 'e'].map((id) => request(id)))).toBe(1)
  })

  test('one unit over the limit refuses with PUBLISH_TOO_LARGE', () => {
    // Forces a cut at small sizes: a cycle of three new seeds needs 1,365,000 with headroom.
    publishConfig = { maxPublishGas: 1_000_000n }
    const x = request('x', [fills('y')], [relation('z')])
    const y = request('y', [fills('z')], [relation('x')])
    const z = request('z', [fills('x')], [relation('y')])
    expect(() => expectedPartCount([request('first'), x, y, z])).toThrow(
      expect.objectContaining({
        code: 'PUBLISH_TOO_LARGE',
        message: expect.stringContaining('x, y, z'),
      }),
    )
  })
})

import { describe, expect, test } from 'bun:test'
import { decodeFunctionData, encodeAbiParameters, parseAbi, stringToHex, toFunctionSelector } from 'viem'
import { executorModuleAbi } from '../abi/executor'
import { multiPublishAbi } from '../abi/publisher'
import { encodeExecutorMultiPublish, encodeMultiPublish, type MultiPublishRequest } from './index'

const ACCOUNT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const MODULE = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const b32 = (byte: string) => `0x${byte.repeat(32)}` as `0x${string}`
/** The placeholder for request `i` (SeedPublishLib.placeholder). */
const ph = (i: number) => `0x${(i + 1).toString(16).padStart(64, '0')}` as `0x${string}`
const localIdWord = (localId: string) => stringToHex(localId, { size: 32 })

/**
 * multiPublish as SeedProtocolExtension (interfaces/ISeedProtocol.sol) and SeedProtocolExecutor
 * declare it, transcribed from seed-protocol rather than taken from `multiPublishAbi`, so a
 * field-order mistake there shows up here.
 */
const contractAbi = parseAbi([
  'struct AttestationRequestData { address recipient; uint64 expirationTime; bool revocable; bytes32 refUID; bytes data; uint256 value; }',
  'struct MultiAttestationRequest { bytes32 schema; AttestationRequestData[] data; }',
  'struct PropertyToUpdateWithSeed { uint256 publishIndex; bytes32 propertySchemaUid; bool listElement; uint256 elementIndex; }',
  'struct PublishRequestData { string localId; bytes32 seedUid; bytes32 seedSchemaUid; bytes32 versionUid; bytes32 versionSchemaUid; bool seedIsRevocable; MultiAttestationRequest[] listOfAttestations; PropertyToUpdateWithSeed[] propertiesToUpdate; }',
  'function multiPublish(PublishRequestData[] requests) payable returns (bytes32[])',
])

const RELATION = b32('05')
const LIST = b32('06')
const TITLE = b32('07')

type Reference = MultiPublishRequest['propertiesToUpdate'][number]
type Attestation = MultiPublishRequest['listOfAttestations'][number]

const attestation = (schema: `0x${string}`, ...data: `0x${string}`[]): Attestation => ({
  schema,
  data: data.map((d) => ({
    recipient: '0x0000000000000000000000000000000000000000',
    expirationTime: 0n,
    revocable: true,
    refUID: b32('00'),
    data: d,
    value: 0n,
  })),
})
/** A relation to a draft, as getPublishPayload encodes it: the draft's local id. */
const relation = (localId: string) => attestation(RELATION, localIdWord(localId))
const list = (...members: `0x${string}`[]) =>
  attestation(LIST, encodeAbiParameters([{ type: 'bytes32[]' }], [members]))

function request(localId: string, references: Reference[] = [], attestations: Attestation[] = []): MultiPublishRequest {
  return {
    localId,
    seedUid: b32('01'),
    seedSchemaUid: b32('02'),
    versionUid: b32('03'),
    versionSchemaUid: b32('04'),
    seedIsRevocable: true,
    listOfAttestations: attestations,
    propertiesToUpdate: references,
  }
}
const ref = (publishLocalId: string, rest: Partial<Reference> = {}): Reference => ({
  publishLocalId,
  propertySchemaUid: RELATION,
  ...rest,
})
const decode = (data: `0x${string}`) => decodeFunctionData({ abi: contractAbi, data }).args[0]
const slotOf = (r: { listOfAttestations: readonly { data: readonly { data: string }[] }[] }, n = 0) =>
  r.listOfAttestations[n]!.data[0]!.data

const encoders = [
  ['encodeMultiPublish', (r: MultiPublishRequest[]) => encodeMultiPublish(ACCOUNT, r, 5_000_000n), ACCOUNT],
  ['encodeExecutorMultiPublish', (r: MultiPublishRequest[]) => encodeExecutorMultiPublish(MODULE, r, 5_000_000n), MODULE],
] as const

describe.each(encoders)('%s', (_, encode, to) => {
  test('targets the three-phase multiPublish selector', () => {
    const tx = encode([request('a')])
    expect(tx.to).toBe(to)
    expect(tx.gas).toBe(5_000_000n)
    expect(tx.data.slice(0, 10)).toBe('0xa1263421')
  })

  test('decodes with the contracts\' struct: uids in their fields, publishLocalId as publishIndex', () => {
    const tx = encode([request('a', [ref('c')]), request('b'), request('c', [], [relation('a')])])
    const [first, second, third] = decode(tx.data)
    expect(first!.localId).toBe('a')
    expect(first!.seedUid).toBe(b32('01'))
    expect(first!.seedSchemaUid).toBe(b32('02'))
    expect(first!.versionUid).toBe(b32('03'))
    expect(first!.versionSchemaUid).toBe(b32('04'))
    expect(first!.propertiesToUpdate).toEqual([
      { publishIndex: 2n, propertySchemaUid: RELATION, listElement: false, elementIndex: 0n },
    ])
    expect(second!.propertiesToUpdate).toEqual([])
    expect(third!.propertiesToUpdate).toEqual([])
  })

  test('a relation slot holds its source request\'s placeholder', () => {
    const [, , post] = decode(encode([request('x'), request('author', [ref('post')]), request('post', [], [relation('author')])]).data)
    expect(slotOf(post!)).toBe(ph(1))
  })

  test('a list element holds its source\'s placeholder; published members keep their uids', () => {
    const published = b32('9a')
    const tx = encode([
      request('tag', [ref('post', { propertySchemaUid: LIST, listElement: true, elementIndex: 1 })]),
      request('post', [], [list(published, localIdWord('tag'))]),
    ])
    const [tag, post] = decode(tx.data)
    expect(tag!.propertiesToUpdate).toEqual([
      { publishIndex: 1n, propertySchemaUid: LIST, listElement: true, elementIndex: 1n },
    ])
    expect(slotOf(post!)).toBe(encodeAbiParameters([{ type: 'bytes32[]' }], [[published, ph(0)]]))
  })

  test('a draft listed twice fills both elements', () => {
    const tx = encode([
      request('tag', [
        ref('post', { propertySchemaUid: LIST, listElement: true, elementIndex: 0 }),
        ref('post', { propertySchemaUid: LIST, listElement: true, elementIndex: 1 }),
      ]),
      request('post', [], [list(localIdWord('tag'), localIdWord('tag'))]),
    ])
    expect(slotOf(decode(tx.data)[1]!)).toBe(encodeAbiParameters([{ type: 'bytes32[]' }], [[ph(0), ph(0)]]))
  })

  test('a cycle: each side holds the other\'s placeholder', () => {
    const tx = encode([
      request('a', [ref('b')], [relation('b')]),
      request('b', [ref('a')], [relation('a')]),
    ])
    const [a, b] = decode(tx.data)
    expect(slotOf(a!)).toBe(ph(1))
    expect(slotOf(b!)).toBe(ph(0))
  })

  test('leaves the caller\'s requests unchanged', () => {
    const batch = [request('author', [ref('post')]), request('post', [], [relation('author')])]
    const before = structuredClone(batch)
    encode(batch)
    expect(batch).toEqual(before)
  })
})

test('both encoders produce the same calldata', () => {
  const batch = [request('a', [ref('b')]), request('b', [], [relation('a')])]
  expect(encodeExecutorMultiPublish(MODULE, batch).data).toBe(encodeMultiPublish(ACCOUNT, batch).data)
  expect(toFunctionSelector(multiPublishAbi[0])).toBe('0xa1263421')
  expect(toFunctionSelector(executorModuleAbi[0])).toBe('0xa1263421')
})

describe.each(encoders)('%s refuses a reference it cannot resolve', (_, encode) => {
  test('a localId that is not in the batch, naming it', () => {
    expect(() => encode([request('a', [ref('no-such-request')]), request('b')])).toThrow(/"no-such-request"/)
  })

  test('an empty publishLocalId, naming the request', () => {
    expect(() => encode([request('a', [ref('')]), request('b')])).toThrow(/"a".*no publishLocalId/)
  })

  test('a missing publishLocalId', () => {
    const r = request('a', [{ propertySchemaUid: RELATION } as Reference])
    expect(() => encode([r, request('b')])).toThrow(/no publishLocalId/)
  })

  test('a duplicate localId, naming it', () => {
    expect(() => encode([request('dup'), request('dup')])).toThrow(/duplicate localId "dup"/)
  })
})

describe.each(encoders)('%s refuses what the contract would revert on', (_, encode) => {
  const target = (...attestations: Attestation[]) => request('post', [], attestations)

  test('a property the target does not attest', () => {
    expect(() => encode([request('a', [ref('post')]), target(attestation(TITLE, b32('00')))])).toThrow(
      /"a" references property .* of "post", which that request doesn't attest/,
    )
  })

  test('a property attested twice, or with two entries', () => {
    expect(() => encode([request('a', [ref('post')]), target(relation('a'), relation('a'))])).toThrow(/exactly once/)
    const twoEntries = attestation(RELATION, localIdWord('a'), localIdWord('a'))
    expect(() => encode([request('a', [ref('post')]), target(twoEntries)])).toThrow(/exactly once/)
  })

  test('a relation that is not a single bytes32', () => {
    const text = attestation(RELATION, encodeAbiParameters([{ type: 'string' }], ['a']))
    expect(() => encode([request('a', [ref('post')]), target(text)])).toThrow(/isn't a single bytes32/)
  })

  test('an element index on a relation', () => {
    expect(() => encode([request('a', [ref('post', { elementIndex: 1 })]), target(relation('a'))])).toThrow(
      /element index, but not as a list element/,
    )
  })

  test('a list element past the end of the list', () => {
    const r = request('a', [ref('post', { propertySchemaUid: LIST, listElement: true, elementIndex: 1 })])
    expect(() => encode([r, target(list(localIdWord('a')))])).toThrow(/element 1, past the end of its 1-element list/)
  })

  test('a list element in a property that is not a bytes32[]', () => {
    const r = request('a', [ref('post', { listElement: true })])
    expect(() => encode([r, target(relation('a'))])).toThrow(/isn't a bytes32\[\]/)
  })

  test('two references to one slot', () => {
    const batch = [request('a', [ref('post')]), request('b', [ref('post')]), target(relation('a'))]
    expect(() => encode(batch)).toThrow(/"b" references .* a slot another reference already fills/)
  })
})

describe.each(encoders)('%s refuses a slot no reference fills', (_, encode) => {
  test('a relation holding the local id of a request in the batch', () => {
    expect(() => encode([request('author'), request('post', [], [relation('author')])])).toThrow(
      /"post" attests the local id of "author" .* no reference fills it/,
    )
  })

  test('a list element holding one', () => {
    const r = request('tag', [ref('post', { propertySchemaUid: LIST, listElement: true, elementIndex: 0 })])
    expect(() => encode([r, request('post', [], [list(localIdWord('tag'), localIdWord('tag'))])])).toThrow(
      /"post" attests the local id of "tag"/,
    )
  })

  test('a local id that is not in the batch is left alone', () => {
    expect(() => encode([request('post', [], [relation('elsewhere')])])).not.toThrow()
  })
})

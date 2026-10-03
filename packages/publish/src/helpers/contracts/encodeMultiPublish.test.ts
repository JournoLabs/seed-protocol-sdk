import { describe, expect, test } from 'bun:test'
import { decodeFunctionData, parseAbi, toFunctionSelector } from 'viem'
import { executorModuleAbi } from '../abi/executor'
import { multiPublishAbi } from '../abi/publisher'
import { encodeExecutorMultiPublish, encodeMultiPublish, type MultiPublishRequest } from './index'

const ACCOUNT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const MODULE = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const b32 = (byte: string) => `0x${byte.repeat(32)}` as `0x${string}`

/**
 * multiPublish as SeedProtocolExtension (interfaces/ISeedProtocol.sol) and SeedProtocolExecutor
 * declare it, transcribed from seed-protocol rather than taken from `multiPublishAbi`, so a
 * field-order mistake there shows up here.
 */
const contractAbi = parseAbi([
  'struct AttestationRequestData { address recipient; uint64 expirationTime; bool revocable; bytes32 refUID; bytes data; uint256 value; }',
  'struct MultiAttestationRequest { bytes32 schema; AttestationRequestData[] data; }',
  'struct PropertyToUpdateWithSeed { uint256 publishIndex; bytes32 propertySchemaUid; }',
  'struct PublishRequestData { string localId; bytes32 seedUid; bytes32 seedSchemaUid; bytes32 versionUid; bytes32 versionSchemaUid; bool seedIsRevocable; MultiAttestationRequest[] listOfAttestations; PropertyToUpdateWithSeed[] propertiesToUpdate; }',
  'function multiPublish(PublishRequestData[] requests) payable returns (bytes32[])',
])

function request(localId: string, publishLocalIds: string[]): MultiPublishRequest {
  return {
    localId,
    seedUid: b32('01'),
    seedSchemaUid: b32('02'),
    versionUid: b32('03'),
    versionSchemaUid: b32('04'),
    seedIsRevocable: true,
    listOfAttestations: [],
    propertiesToUpdate: publishLocalIds.map((publishLocalId) => ({
      publishLocalId,
      propertySchemaUid: b32('05'),
    })),
  }
}

const encoders = [
  ['encodeMultiPublish', (r: MultiPublishRequest[]) => encodeMultiPublish(ACCOUNT, r, 5_000_000n), ACCOUNT],
  ['encodeExecutorMultiPublish', (r: MultiPublishRequest[]) => encodeExecutorMultiPublish(MODULE, r, 5_000_000n), MODULE],
] as const

describe.each(encoders)('%s', (_, encode, to) => {
  test('targets the multiPublish selector', () => {
    const tx = encode([request('a', [])])
    expect(tx.to).toBe(to)
    expect(tx.gas).toBe(5_000_000n)
    expect(tx.data.slice(0, 10)).toBe('0x2a29fadc')
  })

  test('decodes with the contracts\' struct: uids in their fields, publishLocalId as publishIndex', () => {
    const tx = encode([request('a', ['c']), request('b', ['c']), request('c', [])])
    const { args } = decodeFunctionData({ abi: contractAbi, data: tx.data })
    const [first, second, third] = args[0]
    expect(first.localId).toBe('a')
    expect(first.seedUid).toBe(b32('01'))
    expect(first.seedSchemaUid).toBe(b32('02'))
    expect(first.versionUid).toBe(b32('03'))
    expect(first.versionSchemaUid).toBe(b32('04'))
    expect(first.propertiesToUpdate).toEqual([{ publishIndex: 2n, propertySchemaUid: b32('05') }])
    expect(second.propertiesToUpdate).toEqual([{ publishIndex: 2n, propertySchemaUid: b32('05') }])
    expect(third.propertiesToUpdate).toEqual([])
  })
})

test('both encoders produce the same calldata', () => {
  const batch = [request('a', ['b']), request('b', [])]
  expect(encodeExecutorMultiPublish(MODULE, batch).data).toBe(encodeMultiPublish(ACCOUNT, batch).data)
  expect(toFunctionSelector(multiPublishAbi[0])).toBe('0x2a29fadc')
  expect(toFunctionSelector(executorModuleAbi[0])).toBe('0x2a29fadc')
})

describe.each(encoders)('%s refuses a reference it cannot resolve', (_, encode) => {
  test('a localId that is not in the batch, naming it', () => {
    expect(() => encode([request('a', ['no-such-request']), request('b', [])])).toThrow(/"no-such-request"/)
  })

  test('an empty publishLocalId, naming the request', () => {
    expect(() => encode([request('a', ['']), request('b', [])])).toThrow(/"a".*no publishLocalId/)
  })

  test('a missing publishLocalId', () => {
    const r = request('a', [])
    r.propertiesToUpdate = [{ propertySchemaUid: b32('05') } as any]
    expect(() => encode([r, request('b', [])])).toThrow(/no publishLocalId/)
  })

  test('a duplicate localId, naming it', () => {
    expect(() => encode([request('dup', []), request('dup', [])])).toThrow(/duplicate localId "dup"/)
  })
})

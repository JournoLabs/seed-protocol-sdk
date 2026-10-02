import { describe, expect, test } from 'bun:test'
import { decodeFunctionData, toFunctionSelector } from 'viem'
import { executorModuleAbi } from '../abi/executor'
import { encodeExecutorMultiPublish, type MultiPublishRequest } from './index'

const MODULE = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const b32 = (byte: string) => `0x${byte.repeat(32)}` as `0x${string}`

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

describe('encodeExecutorMultiPublish', () => {
  test('uses the executor module multiPublish selector', () => {
    const tx = encodeExecutorMultiPublish(MODULE, [request('a', [])], 5_000_000n)
    expect(tx.to).toBe(MODULE)
    expect(tx.gas).toBe(5_000_000n)
    expect(tx.data.slice(0, 10)).toBe('0x2a29fadc')
    expect(toFunctionSelector(executorModuleAbi[0])).toBe('0x2a29fadc')
  })

  test('keeps uids in their fields and maps publishLocalId to publishIndex', () => {
    const tx = encodeExecutorMultiPublish(MODULE, [
      request('a', ['b', 'missing', '']),
      request('b', ['a']),
    ])
    const { args } = decodeFunctionData({ abi: executorModuleAbi, data: tx.data })
    const [first, second] = args[0] as any[]
    expect(first.seedUid).toBe(b32('01'))
    expect(first.seedSchemaUid).toBe(b32('02'))
    expect(first.versionUid).toBe(b32('03'))
    expect(first.versionSchemaUid).toBe(b32('04'))
    expect(first.propertiesToUpdate).toEqual([{ publishIndex: 1n, propertySchemaUid: b32('05') }])
    expect(second.propertiesToUpdate).toEqual([{ publishIndex: 0n, propertySchemaUid: b32('05') }])
  })
})

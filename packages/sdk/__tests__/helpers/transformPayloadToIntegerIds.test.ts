import { describe, it, expect } from 'vitest'
import {
  transformPayloadForExecutor,
  transformPayloadToIntegerIds,
} from '../../../publish/src/helpers/transformPayloadToIntegerIds'

describe('transformPayloadToIntegerIds', () => {
  it('converts localId to localIdIndex and publishLocalId to publishLocalIdIndex', () => {
    const requests = [
      {
        localId: 'abc123',
        seedUid: '0x' + '0'.repeat(64),
        seedSchemaUid: '0x' + '1'.repeat(64),
        versionUid: '0x' + '2'.repeat(64),
        versionSchemaUid: '0x' + '3'.repeat(64),
        seedIsRevocable: true,
        listOfAttestations: [],
        propertiesToUpdate: [],
      },
      {
        localId: 'def456',
        seedUid: '0x' + '0'.repeat(64),
        seedSchemaUid: '0x' + '1'.repeat(64),
        versionUid: '0x' + '2'.repeat(64),
        versionSchemaUid: '0x' + '3'.repeat(64),
        seedIsRevocable: true,
        listOfAttestations: [],
        propertiesToUpdate: [
          { publishLocalId: 'abc123', propertySchemaUid: '0x' + '4'.repeat(64) },
        ],
      },
    ]
    const result = transformPayloadToIntegerIds(requests)
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ localIdIndex: BigInt(0) })
    expect(result[0]).not.toHaveProperty('localId')
    expect(result[1]).toMatchObject({ localIdIndex: BigInt(1) })
    expect(result[1].propertiesToUpdate).toHaveLength(1)
    expect(result[1].propertiesToUpdate![0]).toMatchObject({
      publishLocalIdIndex: BigInt(0),
      propertySchemaUid: '0x' + '4'.repeat(64),
    })
    expect(result[1].propertiesToUpdate![0]).not.toHaveProperty('publishLocalId')
  })

  it('preserves all other fields', () => {
    const requests = [
      {
        localId: 'id1',
        seedUid: '0xaa',
        seedSchemaUid: '0xbb',
        versionUid: '0xcc',
        versionSchemaUid: '0xdd',
        seedIsRevocable: false,
        listOfAttestations: [{ schema: '0xee', data: [] }],
        propertiesToUpdate: [],
      },
    ]
    const result = transformPayloadToIntegerIds(requests)
    expect(result[0]).toMatchObject({
      seedUid: '0xaa',
      seedSchemaUid: '0xbb',
      versionUid: '0xcc',
      versionSchemaUid: '0xdd',
      seedIsRevocable: false,
      listOfAttestations: [{ schema: '0xee', data: [] }],
    })
  })

  it('handles empty propertiesToUpdate', () => {
    const requests = [
      {
        localId: 'only',
        seedUid: '0x' + '0'.repeat(64),
        seedSchemaUid: '0x' + '1'.repeat(64),
        versionUid: '0x' + '2'.repeat(64),
        versionSchemaUid: '0x' + '3'.repeat(64),
        seedIsRevocable: true,
        listOfAttestations: [],
        propertiesToUpdate: [],
      },
    ]
    const result = transformPayloadToIntegerIds(requests)
    expect(result).toHaveLength(1)
    expect(result[0].localIdIndex).toBe(BigInt(0))
    expect(result[0].propertiesToUpdate).toEqual([])
  })

  it('throws when publishLocalId is not found in payload', () => {
    const requests = [
      {
        localId: 'id1',
        seedUid: '0x' + '0'.repeat(64),
        seedSchemaUid: '0x' + '1'.repeat(64),
        versionUid: '0x' + '2'.repeat(64),
        versionSchemaUid: '0x' + '3'.repeat(64),
        seedIsRevocable: true,
        listOfAttestations: [],
        propertiesToUpdate: [
          { publishLocalId: 'nonexistent', propertySchemaUid: '0x' + '4'.repeat(64) },
        ],
      },
    ]
    expect(() => transformPayloadToIntegerIds(requests)).toThrow(
      'publishLocalId "nonexistent" not found in payload',
    )
  })
})

describe('transformPayloadForExecutor', () => {
  it('converts publishLocalId to publishIndex while keeping localId as string', () => {
    const requests = [
      {
        localId: 'abc123',
        seedUid: '0x' + '0'.repeat(64),
        seedSchemaUid: '0x' + '1'.repeat(64),
        versionUid: '0x' + '2'.repeat(64),
        versionSchemaUid: '0x' + '3'.repeat(64),
        seedIsRevocable: true,
        listOfAttestations: [],
        propertiesToUpdate: [],
      },
      {
        localId: 'def456',
        seedUid: '0x' + '0'.repeat(64),
        seedSchemaUid: '0x' + '1'.repeat(64),
        versionUid: '0x' + '2'.repeat(64),
        versionSchemaUid: '0x' + '3'.repeat(64),
        seedIsRevocable: true,
        listOfAttestations: [],
        propertiesToUpdate: [
          { publishLocalId: 'abc123', propertySchemaUid: '0x' + '4'.repeat(64) },
        ],
      },
    ]
    const result = transformPayloadForExecutor(requests)
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ localId: 'abc123' })
    expect(result[0].propertiesToUpdate).toEqual([])
    expect(result[1]).toMatchObject({ localId: 'def456' })
    expect(result[1].propertiesToUpdate).toHaveLength(1)
    expect(result[1].propertiesToUpdate![0]).toMatchObject({
      publishIndex: BigInt(0),
      propertySchemaUid: '0x' + '4'.repeat(64),
    })
    expect(result[1].propertiesToUpdate![0]).not.toHaveProperty('publishLocalId')
  })
})

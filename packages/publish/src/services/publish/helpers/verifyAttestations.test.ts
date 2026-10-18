import { describe, expect, test } from 'bun:test'
import { verifyAttestations } from './verifyAttestations'
import { AttestationVerificationError } from '../../../errors'

const SCHEMA_A = '0x' + 'a'.repeat(64)
const SCHEMA_B = '0x' + 'b'.repeat(64)
const VERSION_UID = '0x' + '1'.repeat(64)

const input = {
  normalizedRequests: [
    {
      localId: 'seed-1',
      versionUid: VERSION_UID,
      listOfAttestations: [{ schema: SCHEMA_A }, { schema: SCHEMA_B }],
    },
  ],
  item: { seedLocalId: 'seed-1' },
}

/** An indexer that returns each response in turn, repeating the last one. */
function laggingIndexer(responses: Array<{ schemaId?: string }[] | Error>) {
  const calls: string[][] = []
  const getProperties = async ({ versionUids }: { versionUids: string[] }) => {
    calls.push(versionUids)
    const r = responses[Math.min(calls.length - 1, responses.length - 1)]!
    if (r instanceof Error) throw r
    return r
  }
  return { calls, getProperties }
}

describe('verifyAttestations', () => {
  test('retries while schemas are missing and passes once the indexer catches up', async () => {
    const indexer = laggingIndexer([
      [],
      [{ schemaId: SCHEMA_A }],
      [{ schemaId: SCHEMA_A }, { schemaId: SCHEMA_B }],
    ])

    await verifyAttestations(input, {
      getProperties: indexer.getProperties,
      delayMs: 1,
      maxAttempts: 6,
    })

    expect(indexer.calls).toHaveLength(3)
    expect(indexer.calls[0]).toEqual([VERSION_UID])
  })

  test('fails with METADATA_PROPERTIES_MISSING after the last attempt', async () => {
    const indexer = laggingIndexer([[{ schemaId: SCHEMA_A }]])

    const err = await verifyAttestations(input, {
      getProperties: indexer.getProperties,
      delayMs: 1,
      maxAttempts: 4,
    }).catch((e) => e)

    expect(indexer.calls).toHaveLength(4)
    expect(err).toBeInstanceOf(AttestationVerificationError)
    expect(err.code).toBe('METADATA_PROPERTIES_MISSING')
    expect(err.expectedSchemas).toEqual([SCHEMA_A, SCHEMA_B])
    expect(err.foundSchemas).toEqual([SCHEMA_A])
  })

  test('retries a query error, then verifies', async () => {
    const indexer = laggingIndexer([
      new Error('indexer down'),
      [{ schemaId: SCHEMA_A }, { schemaId: SCHEMA_B }],
    ])

    await verifyAttestations(input, {
      getProperties: indexer.getProperties,
      delayMs: 1,
      maxAttempts: 3,
    })

    expect(indexer.calls).toHaveLength(2)
  })

  test('rethrows the query error when every attempt throws', async () => {
    const indexer = laggingIndexer([new Error('indexer down')])

    const err = await verifyAttestations(input, {
      getProperties: indexer.getProperties,
      delayMs: 1,
      maxAttempts: 2,
    }).catch((e) => e)

    expect(indexer.calls).toHaveLength(2)
    expect(err).not.toBeInstanceOf(AttestationVerificationError)
    expect(err.message).toBe('indexer down')
  })
})

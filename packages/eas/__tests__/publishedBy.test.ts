import { describe, expect, it } from 'vitest'
import {
  decodePublishedByData,
  hashPublishedByBatch,
  verifyPublishedByBatch,
  PUBLISHED_BY_SCHEMA_DEF,
  PUBLISHED_BY_SCHEMA_NAME,
} from '../src/publishedByHelpers.js'
import { normalizeBytes32Hex } from '../src/easUid.js'

const uid = (n: string) => ('0x' + n.repeat(64).slice(0, 64)) as `0x${string}`

describe('publishedBy', () => {
  it('exports schema constants', () => {
    expect(PUBLISHED_BY_SCHEMA_NAME).toBe('seedprotocol.publishedBy')
    expect(PUBLISHED_BY_SCHEMA_DEF).toContain('bytes32[] attestationUids')
    expect(PUBLISHED_BY_SCHEMA_DEF).toContain('bytes32 batchHash')
  })

  it('hashPublishedByBatch is order-independent', () => {
    const a = uid('a')
    const b = uid('b')
    const c = uid('c')
    expect(hashPublishedByBatch([a, b, c])).toBe(hashPublishedByBatch([c, a, b]))
    expect(hashPublishedByBatch([a, b])).not.toBe(hashPublishedByBatch([a, c]))
  })

  it('verifyPublishedByBatch accepts matching hash', () => {
    const uids = [uid('1'), uid('2')]
    const batchHash = hashPublishedByBatch(uids)
    expect(verifyPublishedByBatch({ attestationUids: uids, batchHash })).toBe(true)
    expect(
      verifyPublishedByBatch({
        attestationUids: uids,
        batchHash: uid('f'),
      }),
    ).toBe(false)
  })

  it('decodePublishedByData reads decodedDataJson-shaped fields', () => {
    const seedUid = uid('d')
    const versionUid = uid('e')
    const propUid = uid('f')
    const batchHash = hashPublishedByBatch([seedUid, versionUid, propUid])
    const json = JSON.stringify([
      { name: 'seedUid', value: seedUid, type: 'bytes32' },
      { name: 'versionUid', value: versionUid, type: 'bytes32' },
      { name: 'attestationUids', value: [seedUid, versionUid, propUid], type: 'bytes32[]' },
      { name: 'batchHash', value: batchHash, type: 'bytes32' },
      { name: 'toolName', value: 'Permapress', type: 'string' },
      { name: 'toolVersion', value: '1.0.0', type: 'string' },
    ])
    const decoded = decodePublishedByData(json)
    expect(normalizeBytes32Hex(decoded.seedUid)).toBe(normalizeBytes32Hex(seedUid))
    expect(decoded.toolName).toBe('Permapress')
    expect(decoded.toolVersion).toBe('1.0.0')
    expect(decoded.attestationUids).toHaveLength(3)
    expect(
      verifyPublishedByBatch({
        attestationUids: decoded.attestationUids,
        batchHash: decoded.batchHash,
      }),
    ).toBe(true)
  })
})

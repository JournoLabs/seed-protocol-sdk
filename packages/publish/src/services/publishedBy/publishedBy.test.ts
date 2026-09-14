import { describe, expect, it } from 'bun:test'
import { SchemaRegistry } from '@ethereum-attestation-service/eas-sdk'
import {
  PUBLISHED_BY_SCHEMA_DEF,
  PUBLISHED_BY_SCHEMA_NAME,
  hashPublishedByBatch,
  getPublishedBySchemaUid,
  encodePublishedByAttestationData,
  collectPublishedBatch,
} from './index.ts'
import { ZERO_BYTES32 } from '../../helpers/easDirect.ts'

const uid = (n: string) => ('0x' + n.repeat(64).slice(0, 64)) as `0x${string}`

describe('publishedBy encode + collect', () => {
  it('getPublishedBySchemaUid matches SchemaRegistry', () => {
    const expected = SchemaRegistry.getSchemaUID(
      PUBLISHED_BY_SCHEMA_DEF,
      '0x0000000000000000000000000000000000000000',
      true,
    )
    expect(getPublishedBySchemaUid().toLowerCase()).toBe(String(expected).toLowerCase())
    expect(PUBLISHED_BY_SCHEMA_NAME).toBe('seedprotocol.publishedBy')
  })

  it('encodePublishedByAttestationData produces non-empty hex for both modes', () => {
    const seedUid = uid('a')
    const versionUid = uid('b')
    const props = [uid('c'), uid('d')]
    const batchHash = hashPublishedByBatch([seedUid, versionUid, ...props])

    const withUids = encodePublishedByAttestationData({
      seedUid,
      versionUid,
      attestationUids: [seedUid, versionUid, ...props],
      batchHash,
      toolName: 'TestTool',
      toolVersion: '0.1.0',
    })
    expect(withUids.startsWith('0x')).toBe(true)
    expect(withUids.length).toBeGreaterThan(10)

    const hashOnly = encodePublishedByAttestationData({
      seedUid,
      versionUid,
      attestationUids: [],
      batchHash,
      toolName: 'TestTool',
      toolVersion: '0.1.0',
    })
    expect(hashOnly.startsWith('0x')).toBe(true)
    expect(hashOnly).not.toBe(withUids)
  })

  it('collectPublishedBatch dedupes and skips placeholders', () => {
    const seedUid = uid('1')
    const versionUid = uid('2')
    const prop = uid('3')
    const batch = collectPublishedBatch({
      seedUid,
      versionUid,
      extraUids: [seedUid, prop, ZERO_BYTES32, null, prop],
    })
    expect(batch).not.toBeNull()
    expect(batch!.seedUid.toLowerCase()).toBe(seedUid.toLowerCase())
    expect(batch!.versionUid?.toLowerCase()).toBe(versionUid.toLowerCase())
    expect(batch!.attestationUids.map((u) => u.toLowerCase())).toEqual([
      seedUid.toLowerCase(),
      versionUid.toLowerCase(),
      prop.toLowerCase(),
    ])
  })

  it('collectPublishedBatch returns null for invalid seedUid', () => {
    expect(collectPublishedBatch({ seedUid: ZERO_BYTES32 })).toBeNull()
    expect(collectPublishedBatch({ seedUid: '' })).toBeNull()
  })
})

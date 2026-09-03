import { describe, it, expect } from 'vitest'
import { parseEasPropertyMetadata } from '../src/parseEasPropertyMetadata'
import { pickLatestPropertyAttestationsByRefAndSchema } from '@seedprotocol/eas'

describe('parseEasPropertyMetadata', () => {
  it('parses valid decodedDataJson', () => {
    const raw = JSON.stringify([{ value: { name: 'title', value: 'Hello', type: 'string' } }])
    const result = parseEasPropertyMetadata(raw)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.metadata.name).toBe('title')
      expect(result.metadata.value).toBe('Hello')
    }
  })

  it('rejects empty', () => {
    expect(parseEasPropertyMetadata('').ok).toBe(false)
    expect(parseEasPropertyMetadata(null).ok).toBe(false)
  })

  it('rejects bad shape', () => {
    expect(parseEasPropertyMetadata('{}').ok).toBe(false)
    expect(parseEasPropertyMetadata('[]').ok).toBe(false)
  })
})

describe('latestVersion canonical property pick (eas helper)', () => {
  it('keeps newest attestation per refUID+schemaId', () => {
    const out = pickLatestPropertyAttestationsByRefAndSchema([
      { refUID: 'v1', schemaId: 'sTitle', timeCreated: 10 },
      { refUID: 'v1', schemaId: 'sTitle', timeCreated: 20 },
      { refUID: 'v1', schemaId: 'sBody', timeCreated: 15 },
    ])
    expect(out).toHaveLength(2)
    expect(out.find((a) => a.schemaId === 'sTitle')?.timeCreated).toBe(20)
  })
})

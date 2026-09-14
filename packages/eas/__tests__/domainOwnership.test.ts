import { describe, expect, it } from 'vitest'
import {
  DOMAIN_OWNERSHIP_METHOD,
  DOMAIN_OWNERSHIP_SCHEMA_DEF,
  DOMAIN_OWNERSHIP_SCHEMA_NAME,
  DOMAIN_OWNERSHIP_SCOPE_REGISTRABLE,
  assessDomainOwnership,
  buildDomainOwnershipTxtValue,
  decodeDomainOwnershipData,
  domainOwnershipTxtName,
  hashDomainOwnershipChallenge,
  hashDomainRegistryFingerprint,
  parseDomainOwnershipTxtValue,
  type DomainOwnershipDecoded,
} from '../src/domainOwnershipHelpers.js'
import { normalizeBytes32Hex } from '../src/easUid.js'

const claimer = '0x1111111111111111111111111111111111111111'

function sampleDecoded(over: Partial<DomainOwnershipDecoded> = {}): DomainOwnershipDecoded {
  const domain = over.domain ?? 'example.com'
  const token = 'abcTOKEN'
  return {
    domain,
    claimer,
    method: DOMAIN_OWNERSHIP_METHOD,
    challengeHash: hashDomainOwnershipChallenge({ domain, claimer, token }),
    verifiedAt: Math.floor(Date.now() / 1000) - 60,
    registryCreationDate: '2010-01-01T00:00:00.000Z',
    registryExpirationDate: '2030-01-01T00:00:00.000Z',
    registryFingerprint: hashDomainRegistryFingerprint({
      domain,
      creationDate: '2010-01-01T00:00:00.000Z',
      registrarIanaId: '376',
    }),
    scope: DOMAIN_OWNERSHIP_SCOPE_REGISTRABLE,
    ...over,
  }
}

describe('domainOwnership helpers', () => {
  it('exports schema constants', () => {
    expect(DOMAIN_OWNERSHIP_SCHEMA_NAME).toBe('seedprotocol.domainOwnership')
    expect(DOMAIN_OWNERSHIP_SCHEMA_DEF).toContain('bytes32 challengeHash')
    expect(DOMAIN_OWNERSHIP_SCHEMA_DEF).toContain('bytes32 registryFingerprint')
    expect(DOMAIN_OWNERSHIP_METHOD).toBe('dns-txt-challenge')
  })

  it('builds and parses TXT values', () => {
    const name = domainOwnershipTxtName('Example.COM.')
    expect(name).toBe('_seedprotocol-challenge.example.com')
    const txt = buildDomainOwnershipTxtValue({
      token: 'tok123',
      claimer,
      expiry: '2026-09-15T00:00:00.000Z',
    })
    expect(txt).toContain('token=tok123')
    expect(txt).toContain('addr=')
    const parsed = parseDomainOwnershipTxtValue(`"${txt}"`)
    expect(parsed?.token).toBe('tok123')
    expect(parsed?.claimer).toBe(claimer.toLowerCase())
    expect(parsed?.expiry).toBe('2026-09-15T00:00:00.000Z')
  })

  it('hashDomainOwnershipChallenge is stable and claimer-bound', () => {
    const a = hashDomainOwnershipChallenge({
      domain: 'Example.COM',
      claimer,
      token: 't1',
    })
    const b = hashDomainOwnershipChallenge({
      domain: 'example.com',
      claimer: claimer.toUpperCase(),
      token: 't1',
    })
    expect(a).toBe(b)
    expect(
      hashDomainOwnershipChallenge({ domain: 'example.com', claimer, token: 't2' }),
    ).not.toBe(a)
  })

  it('hashDomainRegistryFingerprint changes when creationDate changes', () => {
    const base = hashDomainRegistryFingerprint({
      domain: 'example.com',
      creationDate: '2010-01-01T00:00:00.000Z',
      registrarIanaId: '376',
    })
    const transferred = hashDomainRegistryFingerprint({
      domain: 'example.com',
      creationDate: '2024-06-01T00:00:00.000Z',
      registrarIanaId: '376',
    })
    expect(base).not.toBe(transferred)
  })

  it('decodeDomainOwnershipData reads decodedDataJson-shaped fields', () => {
    const decodedSample = sampleDecoded()
    const json = JSON.stringify([
      { name: 'domain', value: decodedSample.domain, type: 'string' },
      { name: 'claimer', value: decodedSample.claimer, type: 'address' },
      { name: 'method', value: decodedSample.method, type: 'string' },
      { name: 'challengeHash', value: decodedSample.challengeHash, type: 'bytes32' },
      { name: 'verifiedAt', value: decodedSample.verifiedAt, type: 'uint64' },
      {
        name: 'registryCreationDate',
        value: decodedSample.registryCreationDate,
        type: 'string',
      },
      {
        name: 'registryExpirationDate',
        value: decodedSample.registryExpirationDate,
        type: 'string',
      },
      {
        name: 'registryFingerprint',
        value: decodedSample.registryFingerprint,
        type: 'bytes32',
      },
      { name: 'scope', value: decodedSample.scope, type: 'string' },
    ])
    const decoded = decodeDomainOwnershipData(json)
    expect(decoded.domain).toBe('example.com')
    expect(normalizeBytes32Hex(decoded.challengeHash)).toBe(
      normalizeBytes32Hex(decodedSample.challengeHash),
    )
    expect(decoded.method).toBe(DOMAIN_OWNERSHIP_METHOD)
  })

  it('assessDomainOwnership detects expired, transferred, stale, and valid', () => {
    const decoded = sampleDecoded({
      verifiedAt: Math.floor(Date.now() / 1000) - 60,
    })

    expect(
      assessDomainOwnership({
        decoded,
        expirationTime: Math.floor(Date.now() / 1000) - 10,
      }).status,
    ).toBe('expired')

    expect(
      assessDomainOwnership({
        decoded,
        registrySnapshot: {
          domain: 'example.com',
          creationDate: '2010-01-01T00:00:00.000Z',
          registrarIanaId: '376',
        },
      }).status,
    ).toBe('valid')

    expect(
      assessDomainOwnership({
        decoded,
        registrySnapshot: {
          domain: 'example.com',
          creationDate: '2025-01-01T00:00:00.000Z',
          registrarIanaId: '376',
        },
      }).status,
    ).toBe('likely_transferred')

    expect(assessDomainOwnership({ decoded, registrySnapshot: null }).status).toBe(
      'unknown',
    )

    const old = sampleDecoded({
      verifiedAt: Math.floor(Date.now() / 1000) - 400 * 24 * 60 * 60,
    })
    expect(
      assessDomainOwnership({
        decoded: old,
        now: Date.now(),
      }).status,
    ).toBe('stale')
  })
})

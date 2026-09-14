import { describe, expect, it } from 'bun:test'
import {
  DOMAIN_OWNERSHIP_METHOD,
  DOMAIN_OWNERSHIP_SCHEMA_DEF,
  DOMAIN_OWNERSHIP_SCHEMA_NAME,
  hashDomainOwnershipChallenge,
  parseDomainOwnershipTxtValue,
} from '@seedprotocol/eas'
import {
  createDomainOwnershipChallenge,
  encodeDomainOwnershipAttestationData,
  fingerprintFromRegistrySnapshot,
  getDomainOwnershipSchemaUid,
  verifyDomainOwnershipChallenge,
  verifyDomainOwnershipDns,
} from './index'

const claimer = '0x1111111111111111111111111111111111111111'

describe('domainOwnership', () => {
  it('exports schema constants and deterministic schema UID', () => {
    expect(DOMAIN_OWNERSHIP_SCHEMA_NAME).toBe('seedprotocol.domainOwnership')
    expect(DOMAIN_OWNERSHIP_SCHEMA_DEF).toContain('challengeHash')
    expect(DOMAIN_OWNERSHIP_METHOD).toBe('dns-txt-challenge')
    const uid = getDomainOwnershipSchemaUid()
    expect(uid).toMatch(/^0x[0-9a-fA-F]{64}$/)
    expect(getDomainOwnershipSchemaUid()).toBe(uid)
  })

  it('createDomainOwnershipChallenge returns TXT material bound to claimer', () => {
    const challenge = createDomainOwnershipChallenge({
      domain: 'www.example.com',
      claimer,
      normalizeRegistrable: true,
    })
    expect(challenge.domain).toBe('example.com')
    expect(challenge.txtName).toBe('_seedprotocol-challenge.example.com')
    expect(challenge.txtValue).toContain('token=')
    expect(challenge.txtValue).toContain('addr=')
    const parsed = parseDomainOwnershipTxtValue(challenge.txtValue)
    expect(parsed?.token).toBe(challenge.token)
    expect(
      hashDomainOwnershipChallenge({
        domain: challenge.domain,
        claimer: challenge.claimer,
        token: challenge.token,
        scope: challenge.scope,
      }),
    ).toBe(challenge.challengeHash)
  })

  it('verifyDomainOwnershipDns accepts injected matching lookups', async () => {
    const challenge = createDomainOwnershipChallenge({
      domain: 'example.com',
      claimer,
      normalizeRegistrable: false,
    })
    const result = await verifyDomainOwnershipDns(challenge, {
      lookups: [
        async () => ({ source: 'a', values: [challenge.txtValue] }),
        async () => ({ source: 'b', values: [challenge.txtValue] }),
      ],
    })
    expect(result.ok).toBe(true)
    expect(result.matchedSources).toEqual(['a', 'b'])
  })

  it('verifyDomainOwnershipChallenge succeeds with mocks', async () => {
    const challenge = createDomainOwnershipChallenge({
      domain: 'example.com',
      claimer,
      normalizeRegistrable: false,
    })
    const verified = await verifyDomainOwnershipChallenge({
      challenge,
      dnsLookups: [
        async () => ({ source: 'a', values: [challenge.txtValue] }),
        async () => ({ source: 'b', values: [challenge.txtValue] }),
      ],
      registryLookup: async () => ({
        domain: 'example.com',
        creationDate: '2010-01-01T00:00:00.000Z',
        registrarIanaId: '376',
        expirationDate: '2030-01-01T00:00:00.000Z',
      }),
    })
    expect(verified.ok).toBe(true)
    expect(verified.registrySnapshot?.registrarIanaId).toBe('376')
    expect(verified.challengeHash).toBe(challenge.challengeHash)
  })

  it('encodeDomainOwnershipAttestationData returns hex', () => {
    const challenge = createDomainOwnershipChallenge({
      domain: 'example.com',
      claimer,
      normalizeRegistrable: false,
    })
    const fp = fingerprintFromRegistrySnapshot({
      domain: 'example.com',
      creationDate: '2010-01-01T00:00:00.000Z',
      registrarIanaId: '376',
    })
    const encoded = encodeDomainOwnershipAttestationData({
      domain: 'example.com',
      claimer,
      method: DOMAIN_OWNERSHIP_METHOD,
      challengeHash: challenge.challengeHash,
      verifiedAt: Math.floor(Date.now() / 1000),
      registryCreationDate: '2010-01-01T00:00:00.000Z',
      registryExpirationDate: '2030-01-01T00:00:00.000Z',
      registryFingerprint: fp,
      scope: challenge.scope,
    })
    expect(encoded).toMatch(/^0x[0-9a-fA-F]+$/)
    expect(encoded.length).toBeGreaterThan(10)
  })

  it('verifyDomainOwnershipDns rejects expired challenges', async () => {
    const challenge = createDomainOwnershipChallenge({
      domain: 'example.com',
      claimer,
      normalizeRegistrable: false,
      now: Date.now() - 100_000,
      ttlMs: 1_000,
    })
    const result = await verifyDomainOwnershipDns(challenge, {
      now: Date.now(),
      lookups: [async () => ({ source: 'a', values: [challenge.txtValue] })],
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('expired')
  })
})

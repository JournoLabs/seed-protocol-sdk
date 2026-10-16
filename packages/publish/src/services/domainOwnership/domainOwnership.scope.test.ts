import { afterEach, describe, expect, it, mock } from 'bun:test'
import { decodeFunctionData } from 'viem'
import { DOMAIN_OWNERSHIP_SCHEMA_DEF } from '@seedprotocol/eas'
import { SchemaEncoder } from '@ethereum-attestation-service/eas-sdk'
import { easAbi } from '~/helpers/abi/eas'

const claimer = '0x1111111111111111111111111111111111111111'
const tool = '0x2222222222222222222222222222222222222222'
const UID = `0x${'ab'.repeat(32)}`
const registry = {
  domain: 'example.com',
  creationDate: '2010-01-01T00:00:00.000Z',
  registrarIanaId: '376',
  expirationDate: '2099-01-01T00:00:00.000Z',
}

const state = { rows: [] as Array<Record<string, unknown>> }

const easActual = await import('@seedprotocol/eas')
mock.module('@seedprotocol/eas', () => ({
  ...easActual,
  getDomainOwnershipFromEas: async () => state.rows,
}))

const {
  DOMAIN_OWNERSHIP_SCOPE_HOSTNAME,
  DOMAIN_OWNERSHIP_SCOPE_REGISTRABLE,
  assessDomainOwnershipLive,
  attestDomainOwnership,
  createDomainOwnershipChallenge,
  encodeDomainOwnershipAttestationData,
  fingerprintFromRegistrySnapshot,
} = await import('./index')
const { setConfigRef } = await import('~/config')
const { brandTxSender } = await import('~/helpers/seedSigner')

setConfigRef({ uploadApiBaseUrl: 'https://example.com', rpcUrl: 'https://rpc.invalid' })

afterEach(() => {
  state.rows = []
})

/** Captures the attest tx and stops before waiting for a receipt. */
function capturingSender() {
  const sent: Array<{ data: `0x${string}` }> = []
  return {
    sent,
    wallet: brandTxSender({
      address: tool,
      sendTransaction: async (tx) => {
        sent.push(tx)
        throw new Error('captured')
      },
    }),
  }
}

function attestedFields(data: `0x${string}`): Record<string, unknown> {
  const { args } = decodeFunctionData({ abi: easAbi, data })
  const request = args![0] as { data: { data: `0x${string}` } }
  const decoded = new SchemaEncoder(DOMAIN_OWNERSHIP_SCHEMA_DEF).decodeData(request.data.data)
  return Object.fromEntries(decoded.map((f) => [f.name, f.value.value]))
}

describe('domain ownership scope', () => {
  it('a hostname challenge defaults to the hostname scope', () => {
    const challenge = createDomainOwnershipChallenge({
      domain: 'Blog.Example.com.',
      claimer,
      normalizeRegistrable: false,
    })
    expect(challenge.domain).toBe('blog.example.com')
    expect(challenge.scope).toBe(DOMAIN_OWNERSHIP_SCOPE_HOSTNAME)
  })

  it('refuses a registrable scope on a subdomain challenge', () => {
    expect(() =>
      createDomainOwnershipChallenge({
        domain: 'blog.example.com',
        claimer,
        normalizeRegistrable: false,
        scope: DOMAIN_OWNERSHIP_SCOPE_REGISTRABLE,
      }),
    ).toThrow('not a registrable domain')
  })

  it('attests the hostname the challenge was on, not its registrable domain', async () => {
    const challenge = createDomainOwnershipChallenge({
      domain: 'blog.example.com',
      claimer,
      normalizeRegistrable: false,
    })
    const { sent, wallet } = capturingSender()
    await expect(
      attestDomainOwnership({
        wallet,
        domain: challenge.domain,
        claimer,
        challengeHash: challenge.challengeHash,
        registrySnapshot: registry,
        scope: challenge.scope,
        ensureSchema: false,
      }),
    ).rejects.toThrow('captured')
    const fields = attestedFields(sent[0]!.data)
    expect(fields.domain).toBe('blog.example.com')
    expect(fields.scope).toBe(DOMAIN_OWNERSHIP_SCOPE_HOSTNAME)
  })

  it('a registrable challenge still attests the registrable domain', async () => {
    const challenge = createDomainOwnershipChallenge({ domain: 'www.example.com', claimer })
    const { sent, wallet } = capturingSender()
    await expect(
      attestDomainOwnership({
        wallet,
        domain: challenge.domain,
        claimer,
        challengeHash: challenge.challengeHash,
        registrySnapshot: registry,
        scope: challenge.scope,
        ensureSchema: false,
      }),
    ).rejects.toThrow('captured')
    expect(attestedFields(sent[0]!.data).domain).toBe('example.com')
  })
})

describe('assessDomainOwnershipLive', () => {
  function row(expirationTime: number) {
    const encoded = encodeDomainOwnershipAttestationData({
      domain: 'example.com',
      claimer,
      method: 'dns-txt-challenge',
      challengeHash: `0x${'cd'.repeat(32)}`,
      verifiedAt: 1_700_000_000,
      registryCreationDate: registry.creationDate,
      registryExpirationDate: registry.expirationDate,
      registryFingerprint: fingerprintFromRegistrySnapshot(registry),
      scope: DOMAIN_OWNERSHIP_SCOPE_REGISTRABLE,
    })
    const decoded = new SchemaEncoder(DOMAIN_OWNERSHIP_SCHEMA_DEF).decodeData(encoded)
    return { id: UID, expirationTime, decodedDataJson: JSON.stringify(decoded, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)) }
  }

  it('reports an attestation past its EAS expirationTime as expired', async () => {
    const now = Date.now()
    state.rows = [row(Math.floor(now / 1000) - 60)]
    const result = await assessDomainOwnershipLive({
      uid: UID,
      toolAddresses: [tool],
      registryLookup: async () => registry,
      now,
    })
    expect(result.status).toBe('expired')
  })

  it('a live, unexpired attestation with a matching registry is valid', async () => {
    const now = Date.now()
    state.rows = [row(Math.floor(now / 1000) + 3600)]
    const result = await assessDomainOwnershipLive({
      uid: UID,
      toolAddresses: [tool],
      registryLookup: async () => registry,
      now,
    })
    expect(result.status).toBe('valid')
  })
})

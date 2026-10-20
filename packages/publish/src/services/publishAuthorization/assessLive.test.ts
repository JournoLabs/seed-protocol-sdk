import { afterEach, describe, expect, it, mock } from 'bun:test'

const identity = '0x1111111111111111111111111111111111111111'
const sessionKey = '0x2222222222222222222222222222222222222222'
const UID = `0x${'ab'.repeat(32)}`

const state = { rows: [] as Array<Record<string, unknown>> }

const easActual = await import('@seedprotocol/eas')
mock.module('@seedprotocol/eas', () => ({
  ...easActual,
  getPublishAuthorizationFromEas: async () => state.rows,
}))

const { assessPublishAuthorizationLive } = await import('./index')

afterEach(() => {
  state.rows = []
})

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: UID,
    revoked: false,
    expirationTime: 0,
    decodedDataJson: JSON.stringify([
      { name: 'identity', value: identity },
      { name: 'sessionKey', value: sessionKey },
      { name: 'app', value: '0x0000000000000000000000000000000000000000' },
      { name: 'scopes', value: easActual.PUBLISH_AUTHORIZATION_SCOPES },
      { name: 'grantedAt', value: 1 },
      { name: 'expiresAt', value: 0 },
      { name: 'permissionsHash', value: `0x${'cd'.repeat(32)}` },
    ]),
    ...overrides,
  }
}

describe('assessPublishAuthorizationLive', () => {
  it('reports a live grant as valid', async () => {
    state.rows = [row()]
    const result = await assessPublishAuthorizationLive({ uid: UID, identities: [identity] })
    expect(result?.assess.status).toBe('valid')
  })

  it('reports a revoked grant as revoked', async () => {
    state.rows = [row({ revoked: true })]
    const result = await assessPublishAuthorizationLive({ uid: UID, identities: [identity] })
    expect(result?.assess.status).toBe('revoked')
  })

  it('reports a grant past its EAS expirationTime as expired', async () => {
    state.rows = [row({ expirationTime: 1 })]
    const result = await assessPublishAuthorizationLive({ uid: UID, identities: [identity] })
    expect(result?.assess.status).toBe('expired')
  })
})

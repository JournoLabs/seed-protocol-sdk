import { describe, expect, it } from 'vitest'
import {
  PUBLISH_AUTHORIZATION_SCHEMA_DEF,
  PUBLISH_AUTHORIZATION_SCHEMA_NAME,
  PUBLISH_AUTHORIZATION_SCOPES,
  assessPublishAuthorization,
  decodePublishAuthorizationData,
  type PublishAuthorizationDecoded,
} from '../src/publishAuthorizationHelpers.js'

const identity = '0x1111111111111111111111111111111111111111'
const sessionKey = '0x2222222222222222222222222222222222222222'
const app = '0x3333333333333333333333333333333333333333'

function sampleDecoded(over: Partial<PublishAuthorizationDecoded> = {}): PublishAuthorizationDecoded {
  return {
    identity,
    sessionKey,
    app,
    scopes: PUBLISH_AUTHORIZATION_SCOPES,
    grantedAt: Math.floor(Date.now() / 1000) - 60,
    expiresAt: Math.floor(Date.now() / 1000) + 86_400,
    permissionsHash: ('0x' + 'ab'.repeat(32)) as `0x${string}`,
    ...over,
  }
}

describe('publishAuthorization helpers', () => {
  it('exports schema constants', () => {
    expect(PUBLISH_AUTHORIZATION_SCHEMA_NAME).toBe('seedprotocol.publishAuthorization')
    expect(PUBLISH_AUTHORIZATION_SCHEMA_DEF).toContain('bytes32 permissionsHash')
    expect(PUBLISH_AUTHORIZATION_SCOPES).toBe('publish,revoke')
  })

  it('decodePublishAuthorizationData reads named fields', () => {
    const decoded = decodePublishAuthorizationData([
      { name: 'identity', value: identity },
      { name: 'sessionKey', value: sessionKey },
      { name: 'app', value: app },
      { name: 'scopes', value: PUBLISH_AUTHORIZATION_SCOPES },
      { name: 'grantedAt', value: 100 },
      { name: 'expiresAt', value: 200 },
      { name: 'permissionsHash', value: '0x' + 'cd'.repeat(32) },
    ])
    expect(decoded.identity).toBe(identity.toLowerCase())
    expect(decoded.sessionKey).toBe(sessionKey.toLowerCase())
    expect(decoded.grantedAt).toBe(100)
    expect(decoded.expiresAt).toBe(200)
  })

  it('assessPublishAuthorization returns valid / expired / scope_mismatch', () => {
    expect(assessPublishAuthorization({ decoded: sampleDecoded() }).status).toBe('valid')
    expect(
      assessPublishAuthorization({
        decoded: sampleDecoded({ expiresAt: 1 }),
        now: 2_000_000_000_000,
      }).status,
    ).toBe('expired')
    expect(
      assessPublishAuthorization({
        decoded: sampleDecoded({ scopes: 'publish' }),
      }).status,
    ).toBe('scope_mismatch')
  })
})

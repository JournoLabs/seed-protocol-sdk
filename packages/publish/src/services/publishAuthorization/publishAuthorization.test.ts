import { describe, expect, it } from 'bun:test'
import {
  PUBLISH_AUTHORIZATION_SCHEMA_DEF,
  PUBLISH_AUTHORIZATION_SCHEMA_NAME,
  PUBLISH_AUTHORIZATION_SCOPES,
} from '@seedprotocol/eas'
import {
  encodePublishAuthorizationAttestationData,
  getPublishAuthorizationSchemaUid,
} from './index'

const identity = '0x1111111111111111111111111111111111111111'
const sessionKey = '0x2222222222222222222222222222222222222222'

describe('publishAuthorization', () => {
  it('exports schema constants and deterministic schema UID', () => {
    expect(PUBLISH_AUTHORIZATION_SCHEMA_NAME).toBe('seedprotocol.publishAuthorization')
    expect(PUBLISH_AUTHORIZATION_SCHEMA_DEF).toContain('permissionsHash')
    expect(PUBLISH_AUTHORIZATION_SCOPES).toBe('publish,revoke')
    const uid = getPublishAuthorizationSchemaUid()
    expect(uid).toMatch(/^0x[0-9a-fA-F]{64}$/)
    expect(getPublishAuthorizationSchemaUid()).toBe(uid)
  })

  it('encodePublishAuthorizationAttestationData returns hex', () => {
    const encoded = encodePublishAuthorizationAttestationData({
      identity,
      sessionKey,
      app: '0x0000000000000000000000000000000000000000',
      scopes: PUBLISH_AUTHORIZATION_SCOPES,
      grantedAt: Math.floor(Date.now() / 1000),
      expiresAt: 0,
      permissionsHash: '0x' + 'ab'.repeat(32),
    })
    expect(encoded).toMatch(/^0x[0-9a-fA-F]+$/)
    expect(encoded.length).toBeGreaterThan(10)
  })
})

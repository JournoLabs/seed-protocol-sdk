import { describe, expect, it } from 'vitest'
import {
  ARCHIVE_ANCHOR_SCHEMA_DEF,
  ARCHIVE_ANCHOR_SCHEMA_UID,
  ENCRYPTION_KEY_SCHEMA_DEF,
  ENCRYPTION_KEY_SCHEMA_UID,
  VERSION_SCHEMA_DEF,
  VERSION_SCHEMA_UID,
} from '../src/constants.js'
import { PUBLISHED_BY_SCHEMA_DEF } from '../src/publishedByHelpers.js'
import { DOMAIN_OWNERSHIP_SCHEMA_DEF } from '../src/domainOwnershipHelpers.js'
import { PUBLISH_AUTHORIZATION_SCHEMA_DEF } from '../src/publishAuthorizationHelpers.js'
import { seedSchemaModelName, seedSchemaUid } from '../src/seedSchemaUid.js'

describe('seedSchemaUid', () => {
  // UIDs as registered on OP Sepolia (zero resolver, revocable).
  it.each([
    [VERSION_SCHEMA_DEF, VERSION_SCHEMA_UID],
    [ARCHIVE_ANCHOR_SCHEMA_DEF, ARCHIVE_ANCHOR_SCHEMA_UID],
    [ENCRYPTION_KEY_SCHEMA_DEF, ENCRYPTION_KEY_SCHEMA_UID],
    [PUBLISHED_BY_SCHEMA_DEF, '0x8856401efbc464e86c8c4077ded3c6dc4a9d4f8d398a7c1047c2bde9d8f40818'],
    [DOMAIN_OWNERSHIP_SCHEMA_DEF, '0x3c78a221b5a06b61155981a4cdd50556ddf71452dd26d59512163219c18f1e2a'],
    [PUBLISH_AUTHORIZATION_SCHEMA_DEF, '0x04d3bf31bb5c07640f222023ee63b37769a966fc1500e96543ea72fb45b28a19'],
    ['bytes32 image', '0x5442a1004fe4152a06ed806367a989942f7051bad21bbed5b98d855509f79aed'],
  ])('%s', (definition, uid) => {
    expect(seedSchemaUid(definition)).toBe(uid)
  })
})

describe('seedSchemaModelName', () => {
  it('reads the model name from a seed schema registered the way Seed registers it', () => {
    expect(seedSchemaModelName(seedSchemaUid('bytes32 blog_post'), 'bytes32 blog_post')).toBe('blog_post')
    expect(seedSchemaModelName(seedSchemaUid('bytes32 post').toUpperCase().replace('0X', '0x'), 'bytes32 post')).toBe('post')
  })

  it('gives none for the same definition under another UID, or a schema that is not a model schema', () => {
    expect(seedSchemaModelName('0x' + 'd'.repeat(64), 'bytes32 post')).toBeUndefined()
    expect(seedSchemaModelName(seedSchemaUid('string title'), 'string title')).toBeUndefined()
    expect(seedSchemaModelName(seedSchemaUid('bytes32 a,bytes32 b'), 'bytes32 a,bytes32 b')).toBeUndefined()
    expect(seedSchemaModelName(seedSchemaUid('bytes32 post'), undefined)).toBeUndefined()
  })
})

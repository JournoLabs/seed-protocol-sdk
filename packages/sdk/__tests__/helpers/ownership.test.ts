import { describe, expect, it } from 'vitest'
import { ZERO_BYTES32 } from '@/helpers/constants'
import {
  isLocalUnsealedDraft,
  isSeedRowOwned,
  publisherIsInOwnedSet,
} from '@/helpers/ownership'

describe('ownership helpers', () => {
  it('publisherIsInOwnedSet is case-insensitive', () => {
    expect(
      publisherIsInOwnedSet('0xAbC0000000000000000000000000000000000001', [
        '0xabc0000000000000000000000000000000000001',
      ]),
    ).toBe(true)
    expect(publisherIsInOwnedSet(null, ['0xabc'])).toBe(false)
    expect(publisherIsInOwnedSet('0xabc', [])).toBe(false)
  })

  it('isLocalUnsealedDraft requires no publisher, no real uid, no attestationRaw', () => {
    expect(
      isLocalUnsealedDraft({ publisher: null, uid: null, attestationRaw: null }),
    ).toBe(true)
    expect(
      isLocalUnsealedDraft({ publisher: null, uid: ZERO_BYTES32, attestationRaw: '' }),
    ).toBe(true)
    expect(
      isLocalUnsealedDraft({
        publisher: null,
        uid: '0x' + 'a'.repeat(64),
        attestationRaw: null,
      }),
    ).toBe(false)
    expect(
      isLocalUnsealedDraft({
        publisher: null,
        uid: null,
        attestationRaw: '{"attester":"0xabc"}',
      }),
    ).toBe(false)
    expect(
      isLocalUnsealedDraft({
        publisher: '0xabc',
        uid: null,
        attestationRaw: null,
      }),
    ).toBe(false)
  })

  it('isSeedRowOwned: empty owned allows only local drafts', () => {
    expect(
      isSeedRowOwned({ publisher: null, uid: null, attestationRaw: null }, []),
    ).toBe(true)
    expect(
      isSeedRowOwned(
        { publisher: '0xabc', uid: null, attestationRaw: null },
        [],
      ),
    ).toBe(false)
  })

  it('isSeedRowOwned: non-empty owned matches publisher only (null is not owned)', () => {
    const owned = ['0xabc0000000000000000000000000000000000001']
    expect(
      isSeedRowOwned(
        {
          publisher: '0xAbC0000000000000000000000000000000000001',
          uid: '0x' + 'a'.repeat(64),
          attestationRaw: null,
        },
        owned,
      ),
    ).toBe(true)
    expect(
      isSeedRowOwned({ publisher: null, uid: null, attestationRaw: null }, owned),
    ).toBe(false)
    expect(
      isSeedRowOwned(
        {
          publisher: null,
          uid: '0x' + 'b'.repeat(64),
          attestationRaw: null,
        },
        owned,
      ),
    ).toBe(false)
  })
})

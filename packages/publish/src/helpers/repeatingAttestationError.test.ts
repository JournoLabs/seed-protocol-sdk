import { describe, expect, test } from 'bun:test'
import {
  AttestationOutcomeUnknownError,
  ManagedAccountPublishError,
  PublishNonceKeyError,
  type ManagedAccountPublishErrorCode,
} from '../errors'
import { isRepeatingAttestationError } from './repeatingAttestationError'
import { PublishChainConfigError } from './verifyPublishChain'

const REPEATING: ManagedAccountPublishErrorCode[] = [
  'PUBLISH_PREFLIGHT_FAILED',
  'PUBLISH_TOO_LARGE',
  'MULTI_PUBLISH_NOT_ROUTED',
  'USEROP_REVERTED',
  'USEROP_FAILED_NO_REASON',
  'MANAGED_ACCOUNT_NOT_DEPLOYED',
  'EXECUTOR_MODULE_NOT_INSTALLED',
]

describe('isRepeatingAttestationError', () => {
  test('true for each repeating code, wrapped in a cause', () => {
    for (const code of REPEATING) {
      const err = new Error('outer', { cause: new ManagedAccountPublishError('inner', code) })
      expect([code, isRepeatingAttestationError(err)]).toEqual([code, true])
    }
  })

  test('true for a nonce key or chain config error', () => {
    expect(isRepeatingAttestationError(new PublishNonceKeyError('no', 'NONCE_KEY_NOT_PINNED', 'k'))).toBe(true)
    expect(isRepeatingAttestationError(new PublishChainConfigError(11155420, ['no EAS']))).toBe(true)
  })

  // Batch 17 item 7b: a restored publish has its error as the plain object the snapshot's JSON kept
  test('matches a nonce key or chain config error restored from a saved snapshot', () => {
    const restore = (error: Error) => JSON.parse(JSON.stringify({ context: { error } })).context.error
    expect(isRepeatingAttestationError(restore(new PublishNonceKeyError('no', 'NONCE_KEY_NOT_PINNED', 'k')))).toBe(true)
    expect(isRepeatingAttestationError(restore(new PublishChainConfigError(11155420, ['no EAS'])))).toBe(true)
  })

  test('false for NONCE_KEY_UNUSED, whose send a retry settles from its hash', () => {
    const err = new PublishNonceKeyError('unused', 'NONCE_KEY_UNUSED', 'k', undefined, `0x${'a'.repeat(64)}`)
    expect(isRepeatingAttestationError(err)).toBe(false)
  })

  test('false for a timeout, an unknown outcome and other managed-account codes', () => {
    expect(isRepeatingAttestationError(new Error('Timed out while waiting for transaction'))).toBe(false)
    expect(
      isRepeatingAttestationError(
        new AttestationOutcomeUnknownError('post', { id: 'a', txHash: null }, 'noEvidence'),
      ),
    ).toBe(false)
    expect(isRepeatingAttestationError(new ManagedAccountPublishError('x', 'MANAGED_ACCOUNT_UNAVAILABLE'))).toBe(false)
    expect(isRepeatingAttestationError(new ManagedAccountPublishError('x', 'AUTOMATION_PREFLIGHT_FAILED'))).toBe(false)
    expect(isRepeatingAttestationError(undefined)).toBe(false)
  })
})

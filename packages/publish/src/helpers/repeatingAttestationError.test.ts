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

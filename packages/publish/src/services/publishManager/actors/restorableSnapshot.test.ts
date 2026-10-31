import { describe, expect, test } from 'bun:test'
import { isRestorableSnapshot, parkInterruptedAttestation } from './restorableSnapshot'

describe('parkInterruptedAttestation', () => {
  test('a state that can send comes back waiting for a retry, with no actor to re-run', () => {
    for (const value of ['creatingAttestations', 'creatingAttestationsDirectToEas', 'reconcilingAttestations']) {
      const parsed = { value, children: { attest: {} }, context: {} }
      expect(parkInterruptedAttestation(parsed)).toBe(true)
      expect(parsed).toEqual({ value: 'attestationFailureRecoverable', children: {}, context: {} })
    }
  })

  test('other states are left alone', () => {
    const parsed = { value: 'attestationOutcomeUnknown', children: {}, context: {} }
    expect(parkInterruptedAttestation(parsed)).toBe(false)
    expect(parsed.value).toBe('attestationOutcomeUnknown')
  })
})

// Signed data items aren't saved with a publish, so one caught mid bundler upload can't resume.
describe('isRestorableSnapshot', () => {
  test('refuses a publish caught mid bundler upload, unless there was nothing to upload', () => {
    for (const value of ['uploadingViaBundler', 'uploadingViaBundlerPhase2']) {
      expect(isRestorableSnapshot({ value, context: {} })).toBe(false)
      expect(isRestorableSnapshot({ value, context: { bundlerUploadNotNeeded: true } })).toBe(true)
    }
    expect(isRestorableSnapshot({ value: 'creatingAttestations', context: {} })).toBe(true)
  })

  test('refuses a publish saved in a state of the removed L1 upload path', () => {
    for (const value of [
      'creatingArweaveTransactions',
      'sendingReimbursementRequest',
      'pollingForConfirmation',
      'uploadingData',
      'creatingArweaveTransactionsPhase2',
      'sendingReimbursementRequestPhase2',
      'pollingForConfirmationPhase2',
      'uploadingDataPhase2',
    ]) {
      expect(isRestorableSnapshot({ value, context: {} })).toBe(false)
    }
  })
})

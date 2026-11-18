import { describe, expect, test } from 'bun:test'
import { isRestorableSnapshot, parkInterruptedAttestation } from './restorableSnapshot'
import { resumesOnNextLoad } from '../../../hooks/publishProcessHelpers'

describe('parkInterruptedAttestation', () => {
  test('a state that can send comes back waiting for a retry, with no actor to re-run', () => {
    for (const value of ['creatingAttestations', 'creatingAttestationsDirectToEas', 'reconcilingAttestations']) {
      const parsed = { value, children: { attest: {} }, context: {} }
      expect(parkInterruptedAttestation(parsed)).toBe(true)
      expect(parsed).toEqual({ value: 'attestationFailureRecoverable', children: {}, context: {} })
    }
  })

  test('a publish saved while checking a giveUp comes back in the state it gave up from, with no retry', () => {
    const parsed = {
      value: 'checkingGiveUp',
      children: { check: {} },
      context: { giveUpFrom: 'attestationOutcomeUnknown' } as Record<string, unknown>,
    }
    expect(parkInterruptedAttestation(parsed)).toBe(false)
    expect(parsed).toEqual({ value: 'attestationOutcomeUnknown', children: {}, context: {} })

    const noOrigin = { value: 'checkingGiveUp', children: {}, context: {} }
    parkInterruptedAttestation(noOrigin)
    expect(noOrigin.value).toBe('attestationFailureRecoverable')
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

// What a host reads from a publish_processes row to say what the next load does with it.
describe('resumesOnNextLoad', () => {
  const row = (snapshot: unknown) => ({ persistedSnapshot: JSON.stringify(snapshot) })

  test('follows the restore rule for an in-progress publish', () => {
    expect(resumesOnNextLoad(row({ status: 'active', value: 'creatingAttestations', context: {} }))).toBe(true)
    expect(resumesOnNextLoad(row({ status: 'active', value: 'uploadingViaBundler', context: {} }))).toBe(false)
    expect(
      resumesOnNextLoad(row({ status: 'active', value: 'uploadingViaBundler', context: { bundlerUploadNotNeeded: true } })),
    ).toBe(true)
  })

  test('a finished or unreadable snapshot does not resume', () => {
    expect(resumesOnNextLoad(row({ status: 'done', value: 'success', context: {} }))).toBe(false)
    expect(resumesOnNextLoad({ persistedSnapshot: '{not json' })).toBe(false)
  })
})

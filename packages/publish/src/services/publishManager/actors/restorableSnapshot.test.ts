import { describe, expect, test } from 'bun:test'
import { isRestorableSnapshot } from './restorableSnapshot'

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

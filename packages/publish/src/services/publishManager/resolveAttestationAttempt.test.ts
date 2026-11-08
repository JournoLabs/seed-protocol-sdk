import { beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'

const realSdk = await import('@seedprotocol/sdk')

let open: Array<{ id: string }> = []
const updatePublishAttempt = mock(async (_id: string, _update: unknown) => {})
mock.module('@seedprotocol/sdk', () => ({
  ...realSdk,
  findOpenPublishAttempts: async () => open,
  updatePublishAttempt,
}))

const { PublishManager } = await import('./index')

const HASH = `0x${'a'.repeat(64)}`

beforeEach(() => {
  open = [{ id: 'attempt1' }]
  updatePublishAttempt.mockClear()
})

describe('PublishManager.resolveAttestationAttempt', () => {
  test('a named transaction is put on the attempt for the retry to read', async () => {
    await PublishManager.resolveAttestationAttempt('seed1', { txHash: HASH })
    expect(updatePublishAttempt.mock.calls).toEqual([['attempt1', { status: 'sent', txHash: HASH }]])
  })

  // Batch 16 item 45: reconcile would wait on a receipt for whatever was recorded
  test('refuses a txHash that is not a 32-byte hex string, and records nothing', async () => {
    for (const txHash of ['abc', `0x${'a'.repeat(40)}`, 'a'.repeat(64), `0x${'g'.repeat(64)}`]) {
      await expect(PublishManager.resolveAttestationAttempt('seed1', { txHash })).rejects.toThrow(TypeError)
    }
    expect(updatePublishAttempt).not.toHaveBeenCalled()
  })

  test('resend gives the attempt up', async () => {
    await PublishManager.resolveAttestationAttempt('seed1', { resend: true })
    expect(updatePublishAttempt.mock.calls).toEqual([['attempt1', { status: 'abandoned' }]])
  })

  test('no open attempt: nothing to settle', async () => {
    open = []
    await PublishManager.resolveAttestationAttempt('seed1', { resend: true })
    expect(updatePublishAttempt).not.toHaveBeenCalled()
  })

  test('with no run, closes the attempt and warns nothing', async () => {
    // A started manager runs its actions; restore moves on at once with no database.
    process.env.SEED_PUBLISH_RESTORE_WAIT_MS = '0'
    await PublishManager.ready()
    const warn = spyOn(console, 'warn')
    try {
      await PublishManager.resolveAttestationAttempt('seed1', { resend: true })
      expect(updatePublishAttempt.mock.calls).toEqual([['attempt1', { status: 'abandoned' }]])
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})

import { afterEach, describe, expect, mock, test } from 'bun:test'
import { createActor, createMachine } from 'xstate'

const readyMock = mock(() => Promise.resolve())
let ensureResult: unknown = { outcome: 'no_wallet' }
const ensureMock = mock(async (..._args: unknown[]) => ensureResult)

mock.module('../services/publishManager', () => ({
  PublishManager: { ready: () => readyMock() },
}))
mock.module('./ensureWalletThenPublish', () => ({
  ensureWalletThenPublish: (...args: unknown[]) => ensureMock(...args),
}))

const { publishItem, waitForPublishActor } = await import('./publishItem')

/** Stand-in publish actor: starts in `running`, moves on `finish` to the given state. */
function fakePublishActor(endState: string, context: Record<string, unknown> = {}, final = true) {
  const machine = createMachine({
    initial: 'running',
    context,
    states: {
      running: { on: { finish: endState } },
      success: { type: 'final' },
      failure: { type: 'final' },
      stopping: { type: 'final' },
      attestationFailureRecoverable: final ? { type: 'final' } : {},
    },
  })
  const actor = createActor(machine)
  actor.start()
  return actor
}

const item = { seedLocalId: 'seed-1' } as any

afterEach(() => {
  readyMock.mockClear()
  ensureMock.mockClear()
})

describe('waitForPublishActor', () => {
  test('resolves on success', async () => {
    const actor = fakePublishActor('success')
    const done = waitForPublishActor(actor, 'seed-1')
    actor.send({ type: 'finish' })
    await expect(done).resolves.toBeUndefined()
  })

  test('resolves when the actor already succeeded', async () => {
    const actor = fakePublishActor('success')
    actor.send({ type: 'finish' })
    await expect(waitForPublishActor(actor, 'seed-1')).resolves.toBeUndefined()
  })

  test('rejects with the error and step on failure', async () => {
    const actor = fakePublishActor('failure', { error: new Error('upload refused'), errorStep: 'uploadingData' })
    const done = waitForPublishActor(actor, 'seed-1')
    actor.send({ type: 'finish' })
    await expect(done).rejects.toThrow('Publish of seed-1 failed at uploadingData: upload refused')
  })

  test('rejects, pointing at retryAttestations, when attestation waits for a retry', async () => {
    const actor = fakePublishActor('attestationFailureRecoverable', { error: { message: 'nonce too low' } }, false)
    const done = waitForPublishActor(actor, 'seed-1')
    actor.send({ type: 'finish' })
    await expect(done).rejects.toThrow("nonce too low. Uploads are kept; retry with PublishManager.retryAttestations('seed-1')")
  })

  test('rejects when the publish is stopped', async () => {
    const actor = fakePublishActor('stopping')
    const done = waitForPublishActor(actor, 'seed-1')
    actor.send({ type: 'finish' })
    await expect(done).rejects.toThrow('Publish of seed-1 was stopped before it finished.')
  })
})

describe('publishItem', () => {
  test('starts the manager, passes options through, and waits for the publish', async () => {
    const actor = fakePublishActor('success')
    ensureResult = { outcome: 'started', publish: actor, started: Promise.resolve(actor) }
    const done = publishItem(item, { publishMode: 'new_version' })
    await Bun.sleep(0)
    actor.send({ type: 'finish' })
    await expect(done).resolves.toBeUndefined()
    expect(readyMock).toHaveBeenCalledTimes(1)
    expect(ensureMock).toHaveBeenCalledWith(item, { publishMode: 'new_version' })
  })

  test('rejects when no wallet is connected', async () => {
    ensureResult = { outcome: 'no_wallet' }
    await expect(publishItem(item)).rejects.toThrow('No publish wallet is connected.')
  })

  test('rejects with the managed-account error', async () => {
    const error = new Error('managed account unavailable')
    ensureResult = { outcome: 'managed_not_ready', error }
    await expect(publishItem(item)).rejects.toBe(error)
  })

  test('rejects when the seed is already publishing', async () => {
    ensureResult = { outcome: 'already_publishing' }
    await expect(publishItem(item)).rejects.toThrow('already publishing in this tab or another')
  })
})

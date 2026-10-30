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
const { Item } = await import('@seedprotocol/sdk')

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

/** Stand-in item: a running actor, not in the Item cache. */
function fakeItem(seedLocalId: string) {
  const actor = createActor(createMachine({}))
  actor.start()
  const instance: any = { seedLocalId, getService: () => actor }
  instance.unload = () => Item.cache.release(instance)
  return instance
}
const item = fakeItem('seed-1')

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
    const actor = fakePublishActor('failure', { error: new Error('upload refused'), errorStep: 'uploadingViaBundler' })
    const done = waitForPublishActor(actor, 'seed-1')
    actor.send({ type: 'finish' })
    await expect(done).rejects.toThrow('Publish of seed-1 failed at uploadingViaBundler: upload refused')
  })

  test('rejects with the upload size errors themselves, so the app can read their estimate', async () => {
    const { UploadNeedsConfirmError } = await import('../errors')
    const { estimateUpload } = await import('../services/publishCost/uploadEstimate')
    const error = new UploadNeedsConfirmError(estimateUpload({ uploadCount: 1, uploadBytes: 30 * 2 ** 20 }))
    const actor = fakePublishActor('failure', { error, errorStep: 'checking' })
    const done = waitForPublishActor(actor, 'seed-1')
    actor.send({ type: 'finish' })
    await expect(done).rejects.toBe(error)
  })

  test('rejects, pointing at retryAttestations, when attestation waits for a retry', async () => {
    const actor = fakePublishActor('attestationFailureRecoverable', { error: { message: 'nonce too low' } }, false)
    const done = waitForPublishActor(actor, 'seed-1')
    actor.send({ type: 'finish' })
    await expect(done).rejects.toThrow("nonce too low. Uploads are kept; retry with PublishManager.retryAttestations('seed-1')")
  })

  test('rejects with PublishRetractionError when revoking retracted properties fails', async () => {
    const machine = createMachine({
      initial: 'running',
      context: { error: new Error('revoke reverted') },
      states: { running: { on: { finish: 'retractionFailureRecoverable' } }, retractionFailureRecoverable: {} },
    })
    const actor = createActor(machine)
    actor.start()
    const done = waitForPublishActor(actor, 'seed-1')
    actor.send({ type: 'finish' })
    const error = await done.catch((e: unknown) => e)
    expect((error as Error).name).toBe('PublishRetractionError')
    expect((error as Error).message).toContain('Revoking the retracted properties of seed-1 failed: revoke reverted')
    actor.stop()
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

  test('holds a cached item until the publish settles', async () => {
    const cached = fakeItem('seed-held')
    Item.cache.add(cached, ['seed-held'], { hold: true })
    try {
      const actor = fakePublishActor('success')
      ensureResult = { outcome: 'started', publish: actor, started: Promise.resolve(actor) }
      const done = publishItem(cached)
      await Bun.sleep(0)
      expect(Item.cache.entryOf(cached)?.refCount).toBe(2)
      actor.send({ type: 'finish' })
      await done
      expect(Item.cache.entryOf(cached)?.refCount).toBe(1)
    } finally {
      Item.cache.remove(cached)
    }
  })

  test('rejects when the seed is already publishing', async () => {
    ensureResult = { outcome: 'already_publishing' }
    await expect(publishItem(item)).rejects.toThrow('already publishing in this tab or another')
  })
})

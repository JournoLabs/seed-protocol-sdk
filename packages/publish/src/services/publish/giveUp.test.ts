import { beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'

/** giveUp: a publish waiting after a failed attestation ends as failed, unless an attempt is open. */
const realSdk = await import('@seedprotocol/sdk')

let open: () => Promise<Array<{ id: string }>> = async () => []
mock.module('@seedprotocol/sdk', () => ({
  ...realSdk,
  findOpenPublishAttempts: () => open(),
}))

const { createActor, fromPromise, waitFor } = await import('xstate')
const { publishMachine } = await import('./index')
const { ManagedAccountPublishError } = await import('../../errors')
const { errorFieldsFromContext } = await import('../publishManager/actors/savePublish')
const { PublishManager } = await import('../publishManager')

const WAITING = [
  'attestationFailureRecoverable',
  'attestationFailureRecoverableDirectToEas',
  'attestationOutcomeUnknown',
] as const

// A retry's reconcile stays pending, so a test can see that the retry reached it.
const machine = publishMachine.provide({
  actors: { reconcileAttestations: fromPromise(() => new Promise<never>(() => {})) },
})

const waitingRun = (value: string, extra: Record<string, unknown> = {}) => {
  const error = new ManagedAccountPublishError('the UserOp reverted', 'USEROP_REVERTED')
  const context = {
    address: `0x${'c'.repeat(40)}`,
    item: { seedLocalId: 'post' },
    arweaveTransactions: [],
    publishUploads: [],
    publishMode: 'patch',
    error,
    errorStep: 'creatingAttestations',
    ...extra,
  }
  const actor = createActor(machine, { snapshot: machine.resolveState({ value, context: context as any }) })
  return { actor, error }
}

beforeEach(() => {
  open = async () => []
})

describe('giveUp', () => {
  for (const value of WAITING) {
    test(`ends a run waiting in ${value} as failure, keeping its error`, async () => {
      const { actor } = waitingRun(value)
      actor.start()
      actor.send({ type: 'giveUp' } as any)
      const done = await waitFor(actor, (s) => s.value === 'failure')
      expect(errorFieldsFromContext(done.context as any, 'failed')).toMatchObject({
        errorCode: 'USEROP_REVERTED',
        errorStep: 'creatingAttestations',
      })
    })

    test(`stays in ${value} while an attempt is open, and retry still reconciles`, async () => {
      open = async () => [{ id: 'attempt1' }]
      const { actor, error } = waitingRun(value)
      const seen: unknown[] = []
      actor.subscribe((s) => seen.push(s.value))
      actor.start()
      actor.send({ type: 'giveUp' } as any)
      const back = await waitFor(actor, (s) => s.value === value && seen.includes('checkingGiveUp'))
      expect(back.context.error).toBe(error)
      actor.send({ type: 'retry' } as any)
      await waitFor(actor, (s) => s.value === 'reconcilingAttestations')
    })
  }

  test("stays waiting when the attempts can't be read", async () => {
    open = async () => {
      throw new Error('findOpenPublishAttempts: the database is not ready')
    }
    const { actor, error } = waitingRun('attestationOutcomeUnknown')
    const seen: unknown[] = []
    actor.subscribe((s) => seen.push(s.value))
    actor.start()
    actor.send({ type: 'giveUp' } as any)
    const back = await waitFor(actor, (s) => s.value === 'attestationOutcomeUnknown' && seen.includes('checkingGiveUp'))
    expect(back.context.error).toBe(error)
  })

  test('ignores giveUp outside the waiting states', () => {
    for (const value of ['creatingArweaveDataItems', 'creatingAttestations', 'reconcilingAttestations']) {
      const snapshot = machine.resolveState({ value, context: { item: { seedLocalId: 'post' } } as any })
      expect(snapshot.can({ type: 'giveUp' } as any)).toBe(false)
    }
  })
})

describe('PublishManager.giveUpPublish', () => {
  test('with no run, does nothing', async () => {
    process.env.SEED_PUBLISH_RESTORE_WAIT_MS = '0'
    await PublishManager.ready()
    const warn = spyOn(console, 'warn')
    try {
      PublishManager.giveUpPublish('nobody')
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})

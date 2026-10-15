import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
// config first: it imports the publish machine through publishItem, so importing the machine
// module directly first would enter that cycle halfway.
import { setConfigRef } from '~/config'
import { createActor, fromCallback, waitFor } from 'xstate'
import { publishMachine } from '.'
import { PublishNotAuthorizedError } from '~/authorization'

function run(authorizePublish?: (...args: any[]) => unknown) {
  let checkingStarted = false
  const actor = createActor(
    publishMachine.provide({
      actors: {
        // Stand-in for checking (which can send schema registration transactions)
        checking: fromCallback(() => {
          checkingStarted = true
        }) as any,
      },
    }),
    {
      input: {
        item: { seedLocalId: 'seed1234567', modelName: 'Post' },
        address: '0xabc',
        publishMode: 'patch',
        authorizePublish,
      } as any,
    },
  )
  actor.start()
  return { actor, checkingStarted: () => checkingStarted }
}

describe('publish machine authorizing step', () => {
  beforeEach(() => setConfigRef({ uploadApiBaseUrl: 'https://upload.test' }))
  afterEach(() => setConfigRef(null))

  test('a refusing hook fails the publish before checking', async () => {
    const { actor, checkingStarted } = run(() => false)
    const snapshot = await waitFor(actor, (s) => s.status === 'done' || s.value === 'failure', { timeout: 2000 })
    expect(snapshot.context.error).toBeInstanceOf(PublishNotAuthorizedError)
    expect(snapshot.context.errorStep).toBe('authorizing')
    expect(checkingStarted()).toBe(false)
    actor.stop()
  })

  test('an approving hook stores its token and goes on to checking', async () => {
    let seenSeed: string | undefined
    const { actor, checkingStarted } = run((request: { seedLocalId: string }) => {
      seenSeed = request.seedLocalId
      return { token: 'tok' }
    })
    await waitFor(actor, (s) => s.value === 'checking', { timeout: 2000 })
    expect(seenSeed).toBe('seed1234567')
    expect(actor.getSnapshot().context.publishAuthorization).toEqual({ token: 'tok' })
    expect(checkingStarted()).toBe(true)
    actor.stop()
  })

  test('a restored publish (no hook in context) still asks the config hook', async () => {
    setConfigRef({ uploadApiBaseUrl: 'https://upload.test', authorizePublish: () => false })
    const { actor, checkingStarted } = run(undefined)
    const snapshot = await waitFor(actor, (s) => s.value === 'failure', { timeout: 2000 })
    expect(snapshot.context.error).toBeInstanceOf(PublishNotAuthorizedError)
    expect(checkingStarted()).toBe(false)
    actor.stop()
  })

  test('without a hook it goes straight to checking', async () => {
    const { actor, checkingStarted } = run()
    await waitFor(actor, (s) => s.value === 'checking', { timeout: 2000 })
    expect(checkingStarted()).toBe(true)
    expect(actor.getSnapshot().context.publishAuthorization).toEqual({})
    actor.stop()
  })
})

import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
// @ts-expect-error jsdom ships no types and @types/jsdom isn't installed
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { BaseDb } from '@seedprotocol/sdk'
import { createActor, fromCallback, fromPromise } from 'xstate'
import { TEST_TIMEOUT_MS, waitUntilOrThrow } from '../../test-utils/waitUntil'

const dom = new JSDOM('<!doctype html><html><body></body></html>')
Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })
// No DB at startup: restore finishes at once.
process.env.SEED_PUBLISH_RESTORE_WAIT_MS = '0'

/** Rows the hooks' live query of `publish_processes` returns; undefined as with no running client. */
let liveRows: unknown[] | undefined
const realReact = await import('@seedprotocol/react')
mock.module('@seedprotocol/react', () => ({ ...realReact, useLiveQuery: () => liveRows }))

const { createRoot } = await import('react-dom/client')
const { useItemPublishStatus } = await import('./useItemPublishStatus')
const { PublishManager } = await import('../services/publishManager')
const { subscribe } = await import('../services/publishManager/actors/subscribe')
const { publishMachine } = await import('../services/publish')
const { publishLockName, setPublishLockManagerForTests, tryHoldPublishLock } = await import(
  '../services/publishManager/publishLocks'
)
const { fakeLockManager } = await import('../../test-utils/fakeLockManager')

const origGetAppDb = BaseDb.getAppDb.bind(BaseDb)

afterAll(() => {
  BaseDb.getAppDb = origGetAppDb
  delete process.env.SEED_PUBLISH_RESTORE_WAIT_MS
})

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

/**
 * An app DB whose queries and writes wait for `gate`, then return no rows. Every
 * `publish_processes` save blocks until the test opens the gate.
 */
function heldDb(gate: Promise<void>) {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'from', 'where', 'orderBy', 'limit', 'insert', 'values', 'update', 'set']) {
    chain[method] = () => chain
  }
  chain.then = (onFulfilled?: (rows: unknown[]) => unknown, onRejected?: (err: unknown) => unknown) =>
    gate.then(() => [] as unknown[]).then(onFulfilled, onRejected)
  return chain
}

describe('useItemPublishStatus', () => {
  test('a run is not active once it reaches success, while its final save is still being written', async () => {
    await PublishManager.ready()
    const gate = deferred()
    BaseDb.getAppDb = (() => heldDb(gate.promise)) as unknown as typeof BaseDb.getAppDb

    const seedLocalId = 'seed-status-final-save'
    const authorized = deferred<Record<string, never>>()
    // The real publish machine; its invoked work is stubbed so the run reaches success offline.
    const run = createActor(
      publishMachine.provide({
        actors: {
          authorizing: fromPromise(() => authorized.promise),
          checking: fromCallback(({ sendBack }) => {
            sendBack({ type: 'skipArweave', attestationStrategy: 'directEas' })
          }),
          createAttestationsDirectToEas: fromPromise(async () => ({ publishedBatch: null })),
          revokeRetractedProperties: fromPromise(async () => undefined),
        } as never,
      }),
      { input: { item: { seedLocalId } as never, attestationStrategy: 'directEas' } },
    )
    run.start()
    // Register the run the way createPublish does: in publishProcesses, with a subscribe actor.
    PublishManager.savePublish(seedLocalId, run as never)
    PublishManager.addSubscription(
      seedLocalId,
      createActor(subscribe, { input: { publishProcess: run, seedLocalId } }).start(),
    )

    const seen: Array<{ value: string | undefined; isActive: boolean; hasProcess: boolean }> = []
    const Probe = () => {
      const status = useItemPublishStatus(seedLocalId)
      seen.push({ value: status.publishValue, isActive: status.isActive, hasProcess: status.publishProcess != null })
      return null
    }
    const root = createRoot(document.createElement('div'))
    await act(async () => root.render(<Probe />))
    expect(seen.at(-1)).toEqual({ value: 'authorizing', isActive: true, hasProcess: true })

    await act(async () => authorized.resolve({}))
    await act(() => waitUntilOrThrow(() => seen.at(-1)?.value === 'success', 'the run to reach success'))

    // The final save has not finished, so the manager still lists the run.
    expect(PublishManager.getService().getSnapshot().context.publishProcesses.get(seedLocalId)).toBe(run)
    const firstSuccess = seen.find((s) => s.value === 'success')
    expect(firstSuccess).toEqual({ value: 'success', isActive: false, hasProcess: true })
    expect(seen.filter((s) => s.value !== 'success').every((s) => s.isActive)).toBe(true)

    await act(async () => gate.resolve())
    await act(() =>
      waitUntilOrThrow(
        () => !PublishManager.getService().getSnapshot().context.publishProcesses.has(seedLocalId),
        'the final save to settle the run',
      ),
    )
    expect(seen.at(-1)).toEqual({ value: 'success', isActive: false, hasProcess: false })

    await act(async () => root.unmount())
  }, TEST_TIMEOUT_MS)
})

const rowIn = (value: string) => ({
  id: 1,
  seedLocalId: 'unused',
  modelName: 'Post',
  status: 'in_progress',
  startedAt: 1,
  persistedSnapshot: JSON.stringify({ status: 'active', value }),
})

type Seen = { value: string | undefined; heldBy: string | undefined; isActive: boolean }

/** Renders the hook for `seedLocalId` and returns what each render saw. */
async function watch(seedLocalId: string) {
  const seen: Seen[] = []
  const Probe = () => {
    const status = useItemPublishStatus(seedLocalId)
    seen.push({ value: status.publishValue, heldBy: status.heldBy, isActive: status.isActive })
    return null
  }
  const root = createRoot(document.createElement('div'))
  await act(async () => root.render(<Probe />))
  return { seen, unmount: () => act(async () => root.unmount()) }
}

describe('useItemPublishStatus across tabs', () => {
  let otherTab: ReturnType<typeof fakeLockManager>['otherTab']

  const setUp = async () => {
    await PublishManager.ready()
    const fake = fakeLockManager()
    setPublishLockManagerForTests(fake.locks)
    otherTab = fake.otherTab
    BaseDb.getAppDb = (() => heldDb(Promise.resolve())) as unknown as typeof BaseDb.getAppDb
  }

  afterEach(() => {
    liveRows = undefined
    setPublishLockManagerForTests(undefined)
    BaseDb.getAppDb = origGetAppDb
  })

  test("another tab's parked run: heldBy is other-tab and publishValue is the saved state", async () => {
    await setUp()
    const seedLocalId = 'seed-parked-elsewhere'
    otherTab.hold(publishLockName(seedLocalId))
    liveRows = [rowIn('attestationFailureRecoverable')]
    const { seen, unmount } = await watch(seedLocalId)
    await act(() => waitUntilOrThrow(() => seen.at(-1)?.heldBy !== undefined, 'the lock holder to be read'))
    expect(seen.at(-1)).toEqual({ value: 'attestationFailureRecoverable', heldBy: 'other-tab', isActive: true })
    await unmount()
  }, TEST_TIMEOUT_MS)

  test('an orphaned in_progress row: heldBy is none and publishValue stays undefined', async () => {
    await setUp()
    liveRows = [rowIn('attestationFailureRecoverable')]
    const { seen, unmount } = await watch('seed-orphaned')
    await act(() => waitUntilOrThrow(() => seen.at(-1)?.heldBy !== undefined, 'the lock holder to be read'))
    expect(seen.at(-1)).toEqual({ value: undefined, heldBy: 'none', isActive: true })
    await unmount()
  }, TEST_TIMEOUT_MS)

  test("this tab's parked run: heldBy is here and publishValue comes from the run", async () => {
    await setUp()
    const seedLocalId = 'seed-parked-here'
    expect(await tryHoldPublishLock(seedLocalId)).toBe(true)
    const snapshot = publishMachine.resolveState({
      value: 'attestationFailureRecoverable',
      context: { item: { seedLocalId } } as never,
    })
    const run = createActor(publishMachine, { snapshot }).start()
    PublishManager.getService().getSnapshot().context.publishProcesses.set(seedLocalId, run)
    // The row trails the run: it still has the state before the failure.
    liveRows = [rowIn('creatingAttestations')]
    try {
      const { seen, unmount } = await watch(seedLocalId)
      await act(() => waitUntilOrThrow(() => seen.at(-1)?.heldBy !== undefined, 'the lock holder to be read'))
      expect(seen.at(-1)).toEqual({ value: 'attestationFailureRecoverable', heldBy: 'here', isActive: true })
      await unmount()
    } finally {
      PublishManager.getService().getSnapshot().context.publishProcesses.delete(seedLocalId)
      run.stop()
    }
  }, TEST_TIMEOUT_MS)
})

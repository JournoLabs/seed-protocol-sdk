import { afterAll, describe, expect, test } from 'bun:test'
// @ts-expect-error jsdom ships no types and @types/jsdom isn't installed
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createActor, fromCallback, fromPromise } from 'xstate'
import { TEST_TIMEOUT_MS, waitUntilOrThrow } from '../../test-utils/waitUntil'

const dom = new JSDOM('<!doctype html><html><body></body></html>')
Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })
// No DB at startup: restore finishes at once.
process.env.SEED_PUBLISH_RESTORE_WAIT_MS = '0'

// Loaded after jsdom: the SDK imports parse5 as ESM while jsdom require()s it, and a static
// import of both lets Bun hit that require() mid-load ("require() async module").
const { BaseDb } = await import('@seedprotocol/sdk')
const { createRoot } = await import('react-dom/client')
const { useItemPublishStatus } = await import('./useItemPublishStatus')
const { PublishManager } = await import('../services/publishManager')
const { subscribe } = await import('../services/publishManager/actors/subscribe')
const { publishMachine } = await import('../services/publish')

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

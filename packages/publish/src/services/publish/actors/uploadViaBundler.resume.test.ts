import { describe, expect, mock, test } from 'bun:test'
import { createActor, createMachine } from 'xstate'

/**
 * Signed data items aren't saved with a publish, so one restored after a reload has none. The
 * upload must not then count as done: attestations would record items that were never uploaded.
 */
const harness = { uploadTo: 'upload-api' as 'upload-api' | 'turbo' }

mock.module('~/config', () => ({
  getPublishConfig: () => ({ uploadApiBaseUrl: 'http://127.0.0.1:9' }),
}))
mock.module('~/payment', () => ({
  resolvePublishPayment: () => ({
    storage:
      harness.uploadTo === 'turbo'
        ? { payer: 'user', path: 'bundler', uploadTo: 'turbo', turbo: { uploadUrl: 'x', paymentUrl: 'y', paidBy: [] } }
        : { payer: 'operator', path: 'bundler', uploadTo: 'upload-api' },
  }),
}))

const run = async (context: Record<string, unknown>) => {
  const { uploadViaBundler } = await import('./uploadViaBundler')
  const events: { type: string; error?: Error & { code?: string } }[] = []
  const machine = createMachine({
    invoke: { src: uploadViaBundler, input: { context } },
    on: { '*': { actions: ({ event }) => events.push(event as never) } },
  })
  const actor = createActor(machine).start()
  await new Promise((r) => setTimeout(r, 10))
  actor.stop()
  return events[0]
}

describe('uploadViaBundler with no signed data items', () => {
  for (const uploadTo of ['upload-api', 'turbo'] as const) {
    test(`${uploadTo}: fails when they were lost`, async () => {
      harness.uploadTo = uploadTo
      const event = await run({ signedDataItems: undefined })
      expect(event?.type).toBe('uploadError')
      expect(event?.error?.code).toBe('SIGNED_DATA_ITEMS_MISSING')
    })

    test(`${uploadTo}: is done when there was nothing to upload`, async () => {
      harness.uploadTo = uploadTo
      const event = await run({ signedDataItems: [], bundlerUploadNotNeeded: true })
      expect(event?.type).toBe('uploadComplete')
    })
  }
})

describe('uploadViaBundler batch body', () => {
  test('frames each item as uint32 length + bytes without needing a Buffer global', async () => {
    harness.uploadTo = 'upload-api'
    const realFetch = globalThis.fetch
    const realBuffer = globalThis.Buffer
    let body: Uint8Array | undefined
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      body = new Uint8Array(init.body as Uint8Array)
      return new Response(JSON.stringify({ total: 2, succeeded: 2, failed: 0 }))
    }) as typeof fetch
    // Browsers have no Buffer; the actor must not reach for it.
    ;(globalThis as { Buffer?: unknown }).Buffer = undefined
    try {
      const event = await run({
        signedDataItems: [{ raw: new Uint8Array([1, 2, 3]) }, { getRaw: async () => new Uint8Array([9]) }],
      })
      expect(event?.type).toBe('uploadComplete')
    } finally {
      globalThis.fetch = realFetch
      globalThis.Buffer = realBuffer
    }
    expect([...body!]).toEqual([0, 0, 0, 2, 0, 0, 0, 3, 1, 2, 3, 0, 0, 0, 1, 9])
  })
})

describe('signBundlerUploadDataList', () => {
  test('marks the upload not needed when signDataItems uploaded, or there was nothing', async () => {
    const { signBundlerUploadDataList } = await import('./createArweaveDataItems')
    const upload = { blob: new Blob([new Uint8Array([1])]), tags: [], itemPropertyName: 'body' } as never
    const viaSigner = await signBundlerUploadDataList([upload], async () => [{ transaction: { id: 'x' } }] as never, undefined)
    expect(viaSigner.bundlerUploadNotNeeded).toBe(true)
  })
})

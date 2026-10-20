import { describe, expect, test } from 'bun:test'
// Load the config before the machine: they import each other.
import { setConfigRef } from '../../config'
import { createActor, createMachine, fromCallback, fromPromise } from 'xstate'
import { publishMachine } from './index'

/**
 * Html with embedded data: images publishes in two passes: the images (phase 1), then the Html
 * rewritten to point at them (phase 2). On the direct-EAS route the second pass used to be skipped.
 */
describe('Html phase 2, direct EAS', () => {
  test('is uploaded and attested together with phase 1', async () => {
    // No useArweaveBundler: data items are the only upload path.
    setConfigRef({ uploadApiBaseUrl: 'http://127.0.0.1:9' } as never)
    const calls: string[] = []
    let attestedWith: { publishUploads?: unknown[] } | undefined
    const context = {
      attestationStrategy: 'directEas',
      item: { seedLocalId: 'post-2' },
    }
    // The real machine, entered after checking.
    const fromPrepare = createMachine(
      { ...(publishMachine.config as object), initial: 'preparingHtmlEmbedded', context } as never,
      publishMachine.implementations as never,
    )
    const machine = fromPrepare.provide({
      actors: {
        preparingHtmlEmbedded: fromPromise(async () => ({ deferredHtmlSeedLocalIds: ['html-2'] })) as never,
        createArweaveDataItems: fromPromise(async () => ({
          arweaveTransactions: [{ transaction: { id: 'image-item' } }],
          publishUploads: [{ itemPropertyName: 'image' }],
          signedDataItems: [{ id: 'image-item', raw: new Uint8Array([1]) }],
          bundlerUploadNotNeeded: false,
        })) as never,
        uploadViaBundler: fromCallback(({ sendBack, input }: any) => {
          calls.push(`upload:${(input.context.signedDataItems ?? []).map((d: any) => d.id).join(',')}`)
          sendBack({ type: 'uploadComplete' })
        }) as never,
        rewritingHtmlEmbedded: fromPromise(async () => {
          calls.push('rewriteHtml')
        }) as never,
        createArweaveDataItemsPhase2: fromPromise(async () => ({
          arweaveTransactions: [{ transaction: { id: 'html-item' } }],
          publishUploads: [{ itemPropertyName: 'body' }],
          signedDataItems: [{ id: 'html-item', raw: new Uint8Array([2]) }],
          bundlerUploadNotNeeded: false,
        })) as never,
        createAttestationsDirectToEas: fromPromise(async ({ input }: any) => {
          attestedWith = input.context
          calls.push('attest')
          return {}
        }) as never,
      },
    })
    const actor = createActor(machine).start()
    const deadline = Date.now() + 2000
    while (!calls.includes('attest') && Date.now() < deadline) await new Promise((r) => setTimeout(r, 5))
    actor.stop()

    expect(calls).toEqual(['upload:image-item', 'rewriteHtml', 'upload:html-item', 'attest'])
    expect((attestedWith?.publishUploads as { itemPropertyName: string }[]).map((u) => u.itemPropertyName)).toEqual([
      'image',
      'body',
    ])
  })
})

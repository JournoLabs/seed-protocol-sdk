import { describe, expect, test } from 'bun:test'
// Load the config before the machine: they import each other.
import { setConfigRef } from '../../config'
import { createActor, createMachine, fromCallback, fromPromise } from 'xstate'
import { publishMachine } from './index'

/**
 * Html with embedded data: images publishes in two passes: the images (phase 1), then the Html
 * rewritten to point at them (phase 2). On the L1 path both passes need the operator's funding,
 * and on the direct-EAS route the second pass used to be skipped.
 */
describe('Html phase 2 on the L1 path, direct EAS', () => {
  test('is funded, uploaded, and attested together with phase 1', async () => {
    setConfigRef({ uploadApiBaseUrl: 'http://127.0.0.1:9', useArweaveBundler: false } as never)
    const calls: string[] = []
    let attestedWith: { publishUploads?: unknown[]; arweaveTransactions?: unknown[] } | undefined

    const context = {
      attestationStrategy: 'directEas',
      item: { seedLocalId: 'post-1' },
      arweaveTransactions: [{ transaction: { id: 'image-tx' } }],
      publishUploads: [{ itemPropertyName: 'image' }],
      // Phase 1's reimbursement: phase 2 must not reuse it.
      reimbursementTransactionId: 'reimbursement-1',
      requestResponse: { transactionId: 'reimbursement-1' },
      htmlEmbeddedDeferredHtmlSeedLocalIds: ['html-1'],
    }
    // The real machine, entered at phase 1's L1 upload.
    const fromUpload = createMachine(
      { ...(publishMachine.config as object), initial: 'uploadingData', context } as never,
      publishMachine.implementations as never,
    )
    const machine = fromUpload.provide({
      actors: {
        uploadData: fromCallback(({ sendBack, input }: any) => {
          calls.push(`upload:${input.context.arweaveTransactions.map((t: any) => t.transaction.id).join(',')}`)
          sendBack({ type: 'uploadComplete' })
        }) as never,
        rewritingHtmlEmbedded: fromPromise(async () => {
          calls.push('rewriteHtml')
        }) as never,
        createArweaveTransactionsPhase2: fromPromise(async () => ({
          arweaveTransactions: [{ transaction: { id: 'html-tx' } }],
          publishUploads: [{ itemPropertyName: 'body' }],
        })) as never,
        sendReimbursementRequest: fromPromise(async ({ input }: any) => {
          calls.push(`reimburse:${input.context.arweaveTransactions.map((t: any) => t.transaction.id).join(',')}`)
          return { transactionId: input.context.reimbursementTransactionId ?? 'reimbursement-2' }
        }) as never,
        pollForConfirmation: fromPromise(async ({ input }: any) => {
          calls.push(`confirm:${input.context.reimbursementTransactionId}`)
        }) as never,
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

    expect(calls).toEqual([
      'upload:image-tx',
      'rewriteHtml',
      'reimburse:html-tx',
      'confirm:reimbursement-2',
      'upload:html-tx',
      'attest',
    ])
    expect((attestedWith?.publishUploads as { itemPropertyName: string }[]).map((u) => u.itemPropertyName)).toEqual([
      'image',
      'body',
    ])
  })
})

describe('Html phase 2 on the bundler path, direct EAS', () => {
  test('is uploaded and attested together with phase 1', async () => {
    setConfigRef({ uploadApiBaseUrl: 'http://127.0.0.1:9', useArweaveBundler: true } as never)
    const calls: string[] = []
    let attestedWith: { publishUploads?: unknown[] } | undefined
    const context = {
      attestationStrategy: 'directEas',
      item: { seedLocalId: 'post-2' },
      arweaveTransactions: [{ transaction: { id: 'image-item' } }],
      publishUploads: [{ itemPropertyName: 'image' }],
      signedDataItems: [{ id: 'image-item', raw: new Uint8Array([1]) }],
      htmlEmbeddedDeferredHtmlSeedLocalIds: ['html-2'],
    }
    const fromUpload = createMachine(
      { ...(publishMachine.config as object), initial: 'uploadingViaBundler', context } as never,
      publishMachine.implementations as never,
    )
    const machine = fromUpload.provide({
      actors: {
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

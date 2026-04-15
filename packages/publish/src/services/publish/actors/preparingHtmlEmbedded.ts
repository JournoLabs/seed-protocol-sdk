import { prepareHtmlEmbeddedImagesForPublish } from '@seedprotocol/sdk'
import { fromPromise } from 'xstate'
import type { PublishMachineContext } from '../../../types'

type Input = { input: { context: PublishMachineContext } }

/**
 * Creates Image items + co-publish rows for Html `data:image/*` URIs before Arweave/DataItem build.
 * Runs for both L1 and bundler; deferred Html ids drive two-phase upload + rewrite in the machine.
 */
export const preparingHtmlEmbedded = fromPromise(
  async ({ input: { context } }: Input): Promise<{ deferredHtmlSeedLocalIds: string[] }> => {
    const policy = context.htmlEmbeddedDataUriPolicy ?? 'materialize'
    const r = await prepareHtmlEmbeddedImagesForPublish(context.item, policy)
    return { deferredHtmlSeedLocalIds: r.deferredHtmlSeedLocalIds }
  },
)

import { EventObject, fromCallback } from 'xstate'
import type { PublishMachineContext } from '../../../types'
import { getBlobStore } from '~/blobStore'

/** The data items to upload are gone, e.g. the publish was restored after a reload. */
export class MissingSignedDataItemsError extends Error {
  readonly code = 'SIGNED_DATA_ITEMS_MISSING'
  constructor() {
    super(
      'The signed data items to upload are missing (they are not saved with the publish, so a publish resumed after a reload has none). Publish again.',
    )
    this.name = 'MissingSignedDataItemsError'
  }
}

/**
 * Sends the blob store's pending uploads (context.signedDataItems). arweaveTransactions and
 * publishUploads hold the ids for later attestations. When the store already stored them (an app's
 * signDataItems), signedDataItems is undefined and this finishes at once.
 */
export const uploadViaBundler = fromCallback<EventObject, { context: PublishMachineContext }>(
  ({ sendBack, input: { context } }) => {
    const { signedDataItems } = context

    // No items: either there is nothing to upload (the app's signDataItems uploaded them itself,
    // or there were none), or they were lost (they aren't saved with the publish, so a publish
    // restored after a reload has none). Finishing on the second would attest data items that
    // were never uploaded.
    if (!signedDataItems || signedDataItems.length === 0) {
      if (context.bundlerUploadNotNeeded) {
        sendBack({ type: 'uploadComplete', result: 'done' })
      } else {
        sendBack({ type: 'uploadError', error: new MissingSignedDataItemsError() })
      }
      return
    }

    getBlobStore()
      .send(signedDataItems as unknown[], context)
      .then(() => sendBack({ type: 'uploadComplete', result: 'done' }))
      .catch((error) => sendBack({ type: 'uploadError', error }))
  }
)

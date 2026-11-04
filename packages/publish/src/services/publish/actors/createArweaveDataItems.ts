import type { GetPublishUploadDataOptions, PublishUploadData } from '../helpers/getPublishUploadData'
import { fromPromise } from 'xstate'
import type { PublishMachineContext } from '../../../types'
import type { ArweaveTransactionInfo } from '../../../types'
import type { PublishUpload } from '../../../types'
import { getPublishUploadData } from '../helpers/getPublishUploadData'
import { getPublishConfig } from '~/config'
import { getBlobStore } from '~/blobStore'

export type CreateArweaveDataItemsResult = {
  arweaveTransactions: ArweaveTransactionInfo[]
  publishUploads: PublishUpload[]
  /** What uploadViaBundler sends: the blob store's pending uploads. */
  signedDataItems?: unknown[]
  /** Nothing for uploadViaBundler to send: the blob store already stored them, or there were none. */
  bundlerUploadNotNeeded: boolean
}

type PublishInput = { input: { context: PublishMachineContext; event: unknown } }

/**
 * Fixes each upload's id in the configured blob store (phase 1 or phase 2), with signers from the
 * publish, else the config.
 */
export async function prepareUploads(
  uploadDataList: PublishUploadData[],
  context: Pick<PublishMachineContext, 'signDataItems' | 'dataItemSigner' | 'publishAuthorization'>,
): Promise<CreateArweaveDataItemsResult> {
  const config = getPublishConfig()
  const prepared = await getBlobStore().prepare(uploadDataList, {
    signDataItems: context.signDataItems ?? config.signDataItems,
    dataItemSigner: context.dataItemSigner ?? config.dataItemSigner,
    publishAuthorization: context.publishAuthorization,
  })

  return {
    arweaveTransactions: prepared.ids.map((id, i) => ({
      transaction: { id },
      versionId: uploadDataList[i]?.versionLocalId,
      modelName: uploadDataList[i]?.itemPropertyName,
    })),
    publishUploads: uploadDataList.map((u) => ({
      itemPropertyName: u.itemPropertyName,
      itemPropertyLocalId: u.itemPropertyLocalId,
      seedLocalId: u.seedLocalId,
      versionLocalId: u.versionLocalId,
      transactionToSign: null,
    })),
    signedDataItems: prepared.pending,
    bundlerUploadNotNeeded: prepared.pending === undefined || uploadDataList.length === 0,
  }
}

export const createArweaveDataItems = fromPromise(
  async ({ input: { context } }: PublishInput): Promise<CreateArweaveDataItemsResult> => {
    // Uploads are read from rows: a restored publish record's plain item data is enough
    const { item } = context

    const uploadDataOpts: GetPublishUploadDataOptions = {}
    if (context.arweaveUploadTags?.length) {
      uploadDataOpts.arweaveUploadTags = context.arweaveUploadTags
    }
    const def = context.htmlEmbeddedDeferredHtmlSeedLocalIds
    if (def?.length) {
      uploadDataOpts.deferHtmlStorageSeedLocalIds = def
    }
    const uploadDataList = await getPublishUploadData(
      item,
      Object.keys(uploadDataOpts).length ? uploadDataOpts : undefined,
    )
    return prepareUploads(uploadDataList, context)
  }
)

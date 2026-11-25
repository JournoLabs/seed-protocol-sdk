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
 * An upload of a parked run that a run replacing it can use (ADR 0036): one whose
 * `itemPropertyLocalId` and `contentHash` match an upload this run needs, and that the blob store
 * still holds (`BlobStore.reusable` when the store has it, else `assertStored`).
 */
async function reusableTxId(
  upload: PublishUploadData,
  reusable: PublishMachineContext['reusableUploads'],
): Promise<string | undefined> {
  if (!upload.contentHash) return undefined
  const match = reusable?.find(
    (r) => r.itemPropertyLocalId === upload.itemPropertyLocalId && r.contentHash === upload.contentHash,
  )
  if (!match) return undefined
  try {
    const store = getBlobStore()
    if (store.reusable) return (await store.reusable(match.txId, upload)) ? match.txId : undefined
    await store.assertStored([match.txId])
    return match.txId
  } catch {
    return undefined
  }
}

/**
 * Fixes each upload's id in the configured blob store (phase 1 or phase 2), with signers from the
 * publish, else the config. An upload a replaced run already stored (`reusableUploads`) keeps its
 * id and isn't signed or uploaded again.
 */
export async function prepareUploads(
  uploadDataList: PublishUploadData[],
  context: Pick<PublishMachineContext, 'signDataItems' | 'dataItemSigner' | 'publishAuthorization' | 'reusableUploads'>,
): Promise<CreateArweaveDataItemsResult> {
  const config = getPublishConfig()
  const reusedIds = await Promise.all(uploadDataList.map((u) => reusableTxId(u, context.reusableUploads)))
  const toPrepare = uploadDataList.filter((_, i) => reusedIds[i] === undefined)
  const prepared =
    toPrepare.length > 0
      ? await getBlobStore().prepare(toPrepare, {
          signDataItems: context.signDataItems ?? config.signDataItems,
          dataItemSigner: context.dataItemSigner ?? config.dataItemSigner,
          publishAuthorization: context.publishAuthorization,
        })
      : { ids: [] as string[], pending: undefined }
  let next = 0
  const ids = reusedIds.map((id) => id ?? prepared.ids[next++]!)

  return {
    arweaveTransactions: ids.map((id, i) => ({
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
      ...(u.contentHash && { contentHash: u.contentHash }),
    })),
    signedDataItems: prepared.pending,
    bundlerUploadNotNeeded: prepared.pending === undefined || toPrepare.length === 0,
  }
}

/** Phase 1's uploads: everything but deferred Html, encrypted where a property is private. */
export async function executeCreateArweaveDataItems(context: PublishMachineContext): Promise<CreateArweaveDataItemsResult> {
  // Uploads are read from rows: a restored publish record's plain item data is enough
  const { item } = context

  const uploadDataOpts: GetPublishUploadDataOptions = {}
  // From the config, not the context: a restored publish record holds no functions.
  const encryptUpload = getPublishConfig().encryptPrivateUpload
  if (encryptUpload) uploadDataOpts.encryptUpload = encryptUpload
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

export const createArweaveDataItems = fromPromise(
  async ({ input: { context } }: PublishInput): Promise<CreateArweaveDataItemsResult> => executeCreateArweaveDataItems(context),
)

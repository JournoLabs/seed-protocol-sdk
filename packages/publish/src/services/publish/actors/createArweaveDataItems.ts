import type { GetPublishUploadDataOptions, PublishUploadData } from '../helpers/getPublishUploadData'
import debug from 'debug'
import { fromPromise } from 'xstate'
import type { PublishMachineContext } from '../../../types'
import type { ArweaveTransactionInfo } from '../../../types'
import type { PublishUpload } from '../../../types'
import { getPublishUploadData } from '../helpers/getPublishUploadData'
import { readPublishUploadBytes } from '@seedprotocol/sdk'
import { getPublishConfig } from '~/config'
import {
  buildPublishAnchorBytes,
  createSignedDataItem,
  createSignedDataItemWithAccount,
  isEthersWallet,
  verifyDataItem,
} from '~/helpers/arweave'
import { isPublishWallet, type SeedSigner } from '~/helpers/seedSigner'

const logger = debug('seedProtocol:createArweaveDataItems')



export type CreateArweaveDataItemsResult = {
  arweaveTransactions: ArweaveTransactionInfo[]
  publishUploads: PublishUpload[]
  /** Signed DataItems for uploadViaBundler (dataItemSigner path only). */
  signedDataItems?: unknown[]
  /** Nothing for uploadViaBundler to send: signDataItems uploaded the items itself, or there were none. */
  bundlerUploadNotNeeded: boolean
}

type PublishInput = { input: { context: PublishMachineContext; event: unknown } }

type Signers = {
  signDataItems: PublishMachineContext['signDataItems']
  dataItemSigner: PublishMachineContext['dataItemSigner']
}

/**
 * Sign raw upload payloads as DataItems (phase 1 or phase 2). Shared by createArweaveDataItems and phase-2 actor.
 */
export async function signBundlerUploadDataList(
  uploadDataList: PublishUploadData[],
  signDataItems: Signers['signDataItems'],
  dataItemSigner: Signers['dataItemSigner'],
): Promise<CreateArweaveDataItemsResult> {
  let arweaveTransactions: ArweaveTransactionInfo[]
  let signedDataItems: unknown[] | undefined

  if (signDataItems) {
    const result = await signDataItems(uploadDataList)
    arweaveTransactions = result.map((r) => ({
      transaction: { id: r.transaction.id },
      versionId: r.versionId,
      modelName: r.modelName,
    }))
  } else if (dataItemSigner) {
    const items: Awaited<ReturnType<typeof createSignedDataItem>>[] = []
    const timestampMs = Date.now()
    for (let i = 0; i < uploadDataList.length; i++) {
      const upload = uploadDataList[i]!
      const tags = upload.tags
      const data = await readPublishUploadBytes(upload)
      const randomUniq = new Uint8Array(8)
      crypto.getRandomValues(randomUniq)
      const uniqueness =
        (new DataView(randomUniq.buffer).getBigUint64(0, false) ^ BigInt(i)) &
        0xffffffffffffffffn

      let dataItem: Awaited<ReturnType<typeof createSignedDataItem>>
      if (isEthersWallet(dataItemSigner)) {
        const rawAnchor = buildPublishAnchorBytes(dataItemSigner.address, timestampMs, uniqueness)
        dataItem = await createSignedDataItem(data, dataItemSigner, tags, rawAnchor)
      } else {
        const seedSigner: SeedSigner = isPublishWallet(dataItemSigner)
          ? dataItemSigner.signer
          : dataItemSigner
        const rawAnchor = buildPublishAnchorBytes(seedSigner.address, timestampMs, uniqueness)
        dataItem = await createSignedDataItemWithAccount(
          data,
          seedSigner,
          tags,
          rawAnchor,
        )
      }

      const isValid = await verifyDataItem(dataItem.raw)
      if (!isValid) {
        logger('DataItem verification failed: id=%s modelName=%s', dataItem.id, upload.itemPropertyName)
        throw new Error(
          `DataItem signature verification failed for ${upload.itemPropertyName}. ` +
            'The signing key may not match the owner, or the payload may have been modified.'
        )
      }
      items.push(dataItem)
    }
    signedDataItems = items
    arweaveTransactions = items.map((dataItem, i) => ({
      transaction: { id: dataItem.id },
      versionId: uploadDataList[i]?.versionLocalId,
      modelName: uploadDataList[i]?.itemPropertyName,
    }))
  } else {
    throw new Error(
      '@seedprotocol/publish: uploading data items needs signDataItems or a dataItemSigner (pass one at createPublish or in the PublishProvider config). ' +
        "It must be an EOA's key: a smart account's signatures don't verify as Arweave data items, so pass its admin EOA's signer."
    )
  }

  const publishUploads: PublishUpload[] = uploadDataList.map((u) => ({
    itemPropertyName: u.itemPropertyName,
    itemPropertyLocalId: u.itemPropertyLocalId,
    seedLocalId: u.seedLocalId,
    versionLocalId: u.versionLocalId,
    transactionToSign: null,
  }))

  return {
    arweaveTransactions,
    publishUploads,
    signedDataItems,
    bundlerUploadNotNeeded: !!signDataItems || uploadDataList.length === 0,
  }
}

/**
 * Creates DataItems from raw upload data, signs them via signDataItems or dataItemSigner,
 * and returns arweaveTransactions for createAttestations compatibility.
 */
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
    const config = getPublishConfig()
    const signDataItems = context.signDataItems ?? config.signDataItems
    const dataItemSigner = context.dataItemSigner ?? config.dataItemSigner

    return signBundlerUploadDataList(uploadDataList, signDataItems, dataItemSigner)
  }
)

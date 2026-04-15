import type { GetPublishUploadDataOptions, PublishUploadData } from '../helpers/getPublishUploadData'
import debug from 'debug'
import { fromPromise } from 'xstate'
import type { PublishMachineContext } from '../../../types'
import type { ArweaveTransactionInfo } from '../../../types'
import type { PublishUpload } from '../../../types'
import { waitForItem } from './utils'
import { getPublishUploadData } from '../helpers/getPublishUploadData'
import { getPublishConfig } from '~/config'
import {
  buildPublishAnchorBytes,
  createSignedDataItem,
  createSignedDataItemWithAccount,
  isEthersWallet,
  verifyDataItem,
} from '~/helpers/arweave'

const logger = debug('seedProtocol:createArweaveDataItems')



export type CreateArweaveDataItemsResult = {
  arweaveTransactions: ArweaveTransactionInfo[]
  publishUploads: PublishUpload[]
  /** Signed DataItems for uploadViaBundler (dataItemSigner path only). */
  signedDataItems?: unknown[]
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
    const signer = dataItemSigner
    const items: Awaited<ReturnType<typeof createSignedDataItem>>[] = []
    const timestampMs = Date.now()
    const walletAddress = signer.address
    for (let i = 0; i < uploadDataList.length; i++) {
      const upload = uploadDataList[i]!
      const tags = upload.tags
      const randomUniq = new Uint8Array(8)
      crypto.getRandomValues(randomUniq)
      const uniqueness =
        (new DataView(randomUniq.buffer).getBigUint64(0, false) ^ BigInt(i)) &
        0xffffffffffffffffn
      const rawAnchor = buildPublishAnchorBytes(walletAddress, timestampMs, uniqueness)
      const dataItem = isEthersWallet(signer)
        ? await createSignedDataItem(upload.data, signer, tags, rawAnchor)
        : await createSignedDataItemWithAccount(upload.data, signer, tags, rawAnchor)

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
      '@seedprotocol/publish: useArweaveBundler requires signDataItems or dataItemSigner (pass at createPublish or in PublishProvider config)'
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
  }
}

/**
 * Creates DataItems from raw upload data, signs them via signDataItems or dataItemSigner,
 * and returns arweaveTransactions for createAttestations compatibility.
 */
export const createArweaveDataItems = fromPromise(
  async ({ input: { context } }: PublishInput): Promise<CreateArweaveDataItemsResult> => {
    let { item } = context

    if (!item.getPublishUploads) {
      item = await waitForItem(item.seedLocalId)
    }

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
      [],
      undefined,
      Object.keys(uploadDataOpts).length ? uploadDataOpts : undefined,
    )
    const config = getPublishConfig()
    const signDataItems = context.signDataItems ?? config.signDataItems
    const dataItemSigner = context.dataItemSigner ?? config.dataItemSigner

    return signBundlerUploadDataList(uploadDataList, signDataItems, dataItemSigner)
  }
)

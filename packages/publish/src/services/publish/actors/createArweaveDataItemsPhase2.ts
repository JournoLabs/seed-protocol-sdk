import type { GetPublishUploadDataOptions } from '../helpers/getPublishUploadData'
import { fromPromise } from 'xstate'
import type { PublishMachineContext } from '../../../types'
import { waitForItem } from './utils'
import { getPublishUploadData } from '../helpers/getPublishUploadData'
import { getPublishConfig } from '~/config'
import { signBundlerUploadDataList, type CreateArweaveDataItemsResult } from './createArweaveDataItems'

type PublishInput = { input: { context: PublishMachineContext; event: unknown } }

/**
 * Phase 2 (bundler): Html storage DataItems only, after embedded images uploaded and Html rewritten on disk.
 * Exported for unit tests; the XState actor wraps this.
 */
export async function executeCreateArweaveDataItemsPhase2(
  context: PublishMachineContext,
): Promise<CreateArweaveDataItemsResult> {
  let { item } = context
  // A restored publish record carries the item as plain data: load it, and drop that hold after
  const loaded = !item.getPublishUploads ? await waitForItem(item.seedLocalId) : undefined
  if (loaded) item = loaded

  const uploadDataOpts: GetPublishUploadDataOptions = {}
  if (context.arweaveUploadTags?.length) {
    uploadDataOpts.arweaveUploadTags = context.arweaveUploadTags
  }
  const def = context.htmlEmbeddedDeferredHtmlSeedLocalIds
  if (def?.length) {
    uploadDataOpts.onlyHtmlStorageSeedLocalIds = def
    // Walks relations: a related draft's deferred Html (embedded images) is uploaded here too.
  }
  const uploadDataList = await getPublishUploadData(
    item,
    [],
    undefined,
    Object.keys(uploadDataOpts).length ? uploadDataOpts : undefined,
  ).finally(() => loaded?.unload())

  const config = getPublishConfig()
  const signDataItems = context.signDataItems ?? config.signDataItems
  const dataItemSigner = context.dataItemSigner ?? config.dataItemSigner

  if (uploadDataList.length === 0) {
    return {
      arweaveTransactions: [],
      publishUploads: [],
      signedDataItems: undefined,
      bundlerUploadNotNeeded: true,
    }
  }

  return signBundlerUploadDataList(uploadDataList, signDataItems, dataItemSigner)
}

export const createArweaveDataItemsPhase2 = fromPromise(
  async ({ input: { context } }: PublishInput): Promise<CreateArweaveDataItemsResult> =>
    executeCreateArweaveDataItemsPhase2(context),
)

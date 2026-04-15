import { rewriteHtmlEmbeddedImagesOnDisk } from '@seedprotocol/sdk'
import { fromPromise } from 'xstate'
import type { PublishMachineContext } from '../../../types'
import type { ArweaveTransactionInfo } from '../../../types'
import type { PublishUpload } from '../../../types'

type Input = { input: { context: PublishMachineContext } }

function toUploadedPairs(
  txs: ArweaveTransactionInfo[] | undefined,
  ups: PublishUpload[] | undefined,
): { txId: string; seedLocalId?: string; versionLocalId?: string }[] {
  const out: { txId: string; seedLocalId?: string; versionLocalId?: string }[] = []
  const n = Math.min(txs?.length ?? 0, ups?.length ?? 0)
  for (let i = 0; i < n; i++) {
    const t = txs![i]!
    const u = ups![i]!
    const id = t.transaction?.id
    if (typeof id === 'string' && id.length > 0) {
      out.push({ txId: id, seedLocalId: u.seedLocalId, versionLocalId: u.versionLocalId })
    }
  }
  return out
}

export const rewritingHtmlEmbedded = fromPromise(
  async ({ input: { context } }: Input): Promise<void> => {
    const pairs = toUploadedPairs(
      context.htmlEmbeddedPhase1ArweaveTransactions,
      context.htmlEmbeddedPhase1PublishUploads as PublishUpload[] | undefined,
    )
    await rewriteHtmlEmbeddedImagesOnDisk(context.item.seedLocalId, pairs)
  },
)

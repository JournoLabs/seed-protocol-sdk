import type { PublishUpload } from '@/types/publish'

/**
 * Optional executor for Arweave uploads during publish.
 * When provided, runPublish will call this for each upload, sign/post the transaction,
 * and pass the resulting txIds to getPublishPayload.
 * If not provided, uploadedTransactions remains empty (current behavior).
 *
 * Publish flow: The publish package runs ensureEasSchemasForItem before getPublishPayload,
 * which registers EAS schemas and adds naming attestations so EASSCAN displays them.
 * Apps that call item.getPublishPayload() directly (without the publish package flow)
 * must ensure EAS schemas exist and have naming attestations before calling.
 */
export type UploadExecutor = (
  upload: PublishUpload,
) => Promise<{ txId: string }>

let uploadExecutor: UploadExecutor | null = null

export function setUploadExecutor(executor: UploadExecutor | null): void {
  uploadExecutor = executor
}

export function getUploadExecutor(): UploadExecutor | null {
  return uploadExecutor
}

import type { PublishUpload } from '@/types/publish'

/**
 * Optional getter for the publisher address when creating new seeds.
 * When provided and the user is connected (e.g. via Thirdweb), new seeds will have
 * publisher set at creation time. If not provided or user is not connected, publisher
 * remains null until attestation (persistSeedUid).
 */
export type GetPublisherForNewSeeds = () => Promise<string | undefined>

let getPublisherForNewSeeds: GetPublisherForNewSeeds | null = null

export function setGetPublisherForNewSeeds(getter: GetPublisherForNewSeeds | null): void {
  getPublisherForNewSeeds = getter
}

export function getGetPublisherForNewSeeds(): GetPublisherForNewSeeds | null {
  return getPublisherForNewSeeds
}

/** Timeout in ms for getPublisher - prevents wallet autoConnect from hanging seed/version creation */
const PUBLISHER_TIMEOUT_MS = 3000

/**
 * Safely get publisher address with timeout. When user hasn't connected a wallet,
 * getPublisher (e.g. wallet autoConnect) cannot hang - we proceed without publisher.
 */
export async function getPublisherForNewSeedsWithTimeout(): Promise<string | undefined> {
  const getPublisher = getPublisherForNewSeeds
  if (!getPublisher) return undefined
  try {
    return await Promise.race([
      getPublisher(),
      new Promise<undefined>((resolve) =>
        setTimeout(() => resolve(undefined), PUBLISHER_TIMEOUT_MS),
      ),
    ])
  } catch {
    return undefined
  }
}

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

/**
 * Executor for revoking attestations (unpublish).
 * When provided by the publish package, Item.unpublish() will call this to revoke
 * the Seed and all Version/metadata attestations on EAS.
 * If not provided, unpublish will throw.
 */
export type RevokeExecutor = (params: {
  seedLocalId: string
  seedUid: string
  seedSchemaUid: string
}) => Promise<void>

let revokeExecutor: RevokeExecutor | null = null

export function setRevokeExecutor(executor: RevokeExecutor | null): void {
  revokeExecutor = executor
}

export function getRevokeExecutor(): RevokeExecutor | null {
  return revokeExecutor
}

/**
 * Optional getter for additional addresses to include when syncing from EAS.
 * When using modular executor, attestations may have the executor contract as attester
 * rather than the EOA/managed account. The publish package sets this when
 * useModularExecutor and modularAccountModuleContract are configured.
 */
export type GetAdditionalSyncAddresses = () => Promise<string[]>

let getAdditionalSyncAddresses: GetAdditionalSyncAddresses | null = null

export function setAdditionalSyncAddresses(getter: GetAdditionalSyncAddresses | null): void {
  getAdditionalSyncAddresses = getter
}

export function getGetAdditionalSyncAddresses(): GetAdditionalSyncAddresses | null {
  return getAdditionalSyncAddresses
}

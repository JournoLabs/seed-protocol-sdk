import type { PublishUpload } from '@/types/publish'
import type { IItem } from '@/interfaces/IItem'

/**
 * Optional getter for the publisher address when creating new seeds. The publisher makes a new
 * draft owned: once owned addresses are set, a draft with no publisher is read-only.
 *
 * When it returns an address (e.g. a connected wallet), new seeds get it at creation. When there is
 * no getter, or it returns nothing, a new seed gets the owned address if exactly one is set, and
 * otherwise no publisher (until attestation, or claimUnpublishedDrafts). Register one when several
 * owned addresses are set (e.g. an EOA and its smart account), to say which publishes.
 * `@seedprotocol/publish` registers one from the connected wallet.
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
 * Options for `item.publish(options)`. The SDK passes them through untouched to the
 * registered PublishExecutor; with @seedprotocol/publish they are its
 * `CreatePublishOptions` (signers, Arweave tags, `onPublished`, ...).
 */
export type ItemPublishOptions = {
  /** 'patch' (default) updates the current version; 'new_version' starts one. */
  publishMode?: 'patch' | 'new_version'
  [option: string]: unknown
}

/**
 * Publishes an item: uploads its files to Arweave and writes its attestations to EAS.
 * Resolves when the publish has finished and rejects if it failed.
 *
 * The SDK cannot publish on its own. `item.publish()` calls this executor, and
 * @seedprotocol/publish registers it from `initPublish()` (or `<PublishProvider config>`).
 * Without that package, `item.publish()` throws.
 */
export type PublishExecutor = (item: IItem<any>, options?: ItemPublishOptions) => Promise<void>

let publishExecutor: PublishExecutor | null = null

export function setPublishExecutor(executor: PublishExecutor | null): void {
  publishExecutor = executor
}

export function getPublishExecutor(): PublishExecutor | null {
  return publishExecutor
}

export const PUBLISH_NOT_CONFIGURED_MESSAGE =
  'Publishing is not configured. item.publish() needs @seedprotocol/publish: call initPublish() from it, or mount <PublishProvider config={...}>, before publishing.'

/**
 * @deprecated Nothing calls this executor. `item.publish()` delegates the whole
 * publish, uploads included, to the PublishExecutor that @seedprotocol/publish
 * registers. Kept so existing imports compile; it will be removed.
 */
export type UploadExecutor = (
  upload: PublishUpload,
) => Promise<{ txId: string }>

let uploadExecutor: UploadExecutor | null = null

/** @deprecated See UploadExecutor. */
export function setUploadExecutor(executor: UploadExecutor | null): void {
  uploadExecutor = executor
}

/** @deprecated See UploadExecutor. */
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
 * Optional getter for extra EAS indexer attesters (e.g. a legacy executor module).
 * Used for EAS sync and legacy revoke only — never merged into the owned set,
 * `isItemOwned`, or `addressFilter: 'owned'`. The user's smart/managed account
 * belongs in `owned` / `publisherAddress`, not here.
 */
export type GetAdditionalSyncAddresses = () => Promise<string[]>

let getAdditionalSyncAddresses: GetAdditionalSyncAddresses | null = null

export function setAdditionalSyncAddresses(getter: GetAdditionalSyncAddresses | null): void {
  getAdditionalSyncAddresses = getter
}

export function getGetAdditionalSyncAddresses(): GetAdditionalSyncAddresses | null {
  return getAdditionalSyncAddresses
}

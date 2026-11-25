import type { PublishUploadData } from '@seedprotocol/sdk'
import type { PublishMachineContext } from '~/types'

/** What a blob store gets from the publish: its signers (already resolved against the config) and the upload API's authorization. */
export type BlobStoreContext = Pick<PublishMachineContext, 'signDataItems' | 'dataItemSigner' | 'publishAuthorization'>

/** Uploads with their ids fixed. Nothing has necessarily been sent yet. */
export type PreparedBlobs = {
  /** One id per upload, in upload order. Publish writes it as the storage seed's `storageTransactionId`. */
  ids: string[]
  /**
   * What {@link BlobStore.send} uploads. Held in memory only, so a publish restored after a reload
   * has none. Undefined when `prepare` already stored the blobs (an app's `signDataItems`).
   */
  pending?: unknown[]
}

/**
 * Where publish writes Image, File, Html and Json bytes (ADR 0026). Publish runs `prepare`, then
 * `send`, then `assertStored` before any attestation names an id. Ids come out of `prepare` because
 * Html links its embedded images by id before the Html itself is uploaded.
 */
export interface BlobStore {
  /** Names the store in errors and logs: `arweave`, `ipfs`, ... */
  readonly id: string
  /**
   * Whether the store sends uploads through the upload API (`uploadApiBaseUrl`) or Turbo, so that
   * `initPublish` requires `uploadApiBaseUrl` and `estimatePublishCost` prices Arweave storage.
   * `false` for a store that has its own destination, such as IPFS.
   */
  readonly usesUploadApi: boolean
  prepare(uploads: PublishUploadData[], ctx: BlobStoreContext): Promise<PreparedBlobs>
  send(pending: unknown[], ctx: BlobStoreContext): Promise<void>
  /** Throws unless every id can be read back from the store. */
  assertStored(ids: string[]): Promise<void>
  /**
   * Whether a run replacing a parked one (ADR 0036) can reuse `id`, an id this store prepared for
   * `upload` earlier, without preparing the upload again. Publish asks this instead of
   * `assertStored` when the store has it, since `assertStored` only knows the ids it prepared in
   * this session. May store what is missing (a store that writes in several places can finish a
   * write that never landed). Resolves false, or throws, to have the upload prepared again.
   */
  reusable?(id: string, upload: PublishUploadData): Promise<boolean>
}

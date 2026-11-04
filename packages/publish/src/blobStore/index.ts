import { getPublishConfig } from '~/config'
import { arweaveBlobStore } from './arweave'
import type { BlobStore } from './types'

export type { BlobStore, BlobStoreContext, PreparedBlobs } from './types'
export { arweaveBlobStore } from './arweave'

/** The configured {@link PublishConfig.blobStore}, else Arweave. */
export const getBlobStore = (): BlobStore => getPublishConfig().blobStore ?? arweaveBlobStore

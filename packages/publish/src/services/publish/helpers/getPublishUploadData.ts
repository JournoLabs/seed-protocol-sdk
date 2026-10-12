/**
 * Raw upload data (bytes + Content-SHA-256 / Content-Type / configured tags) for the bundler /
 * DataItem path. The builder lives in the SDK (`getPublishUploadData`, next to `getPublishUploads`,
 * which makes L1 transactions from the same data), so both publish paths upload the same bytes
 * with the same tags.
 *
 * Kept as a module of its own so publish actors (and their tests) have one import to mock.
 */
import { getPublishUploadData as sdkGetPublishUploadData } from '@seedprotocol/sdk'
import type { GetPublishUploadsOptions, PublishUploadData } from '@seedprotocol/sdk'

export type { PublishUploadData }

/** Same options as the SDK's getPublishUploads (extra tags, two-phase Html embedded-image publish). */
export type GetPublishUploadDataOptions = GetPublishUploadsOptions

export const getPublishUploadData = (
  ...args: Parameters<typeof sdkGetPublishUploadData>
): ReturnType<typeof sdkGetPublishUploadData> => sdkGetPublishUploadData(...args)

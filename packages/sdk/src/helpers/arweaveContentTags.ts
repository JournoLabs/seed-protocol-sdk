import { sha256 } from '@noble/hashes/sha256'
import { sha3_256 } from '@noble/hashes/sha3'
import { bytesToHex } from '@noble/hashes/utils'
import type { TransactionTag } from '@seedprotocol/arweave'

/**
 * Tag every Seed upload carries with the hex digest of its data. Producers: the SDK's
 * `getPublishUploadData` / `getPublishUploads` (and through them both the L1 transaction path and
 * the bundler / DataItem path in `@seedprotocol/publish`). Consumer: the files download
 * (`events/files/download.ts` and the download worker), which verifies downloaded bytes against it.
 */
export const CONTENT_SHA256_TAG = 'Content-SHA-256'
export const CONTENT_TYPE_TAG = 'Content-Type'

/**
 * Lowercase hex SHA-256 of `data`: the value of the {@link CONTENT_SHA256_TAG} tag.
 *
 * Uses @noble/hashes rather than WebCrypto so it also works outside secure contexts (WebCrypto's
 * `crypto.subtle` is missing on plain-http origins); the digest is the same.
 *
 * In SDK 0.7.2 and earlier the L1 transaction path (`getPublishUploads`) wrote SHA3-256 under this tag name
 * while the bundler path wrote SHA-256. Uploads from that path still carry SHA3-256 digests; use
 * {@link contentSha256TagMatches} to check a tag value against bytes.
 */
export const getContentSha256 = (data: Uint8Array): string => bytesToHex(sha256(data))

/** {@link getContentSha256} of a Blob, read in chunks so the whole file is never in memory. */
export const getBlobSha256 = async (blob: Blob): Promise<string> => {
  const hash = sha256.create()
  const reader = blob.stream().getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return bytesToHex(hash.digest())
    hash.update(value)
  }
}

/**
 * True when `tagValue` (a {@link CONTENT_SHA256_TAG} value read from Arweave) is the digest of
 * `data`. Accepts SHA-256 and, for uploads made by SDK 0.7.2 and earlier through the L1 transaction path,
 * SHA3-256.
 */
export const contentSha256TagMatches = (data: Uint8Array, tagValue: string): boolean => {
  const expected = tagValue.trim().toLowerCase()
  if (!expected) return false
  return getContentSha256(data) === expected || bytesToHex(sha3_256(data)) === expected
}

/**
 * Tags for one upload, in the order every upload uses: content hash, content type, then any
 * configured extra tags (e.g. App-Name from `arweaveUploadTags`).
 */
export const buildArweaveContentTags = (
  contentHash: string | undefined,
  contentType: string | undefined,
  extra?: TransactionTag[],
): TransactionTag[] => {
  const tags: TransactionTag[] = []
  if (contentHash) tags.push({ name: CONTENT_SHA256_TAG, value: contentHash })
  if (contentType) tags.push({ name: CONTENT_TYPE_TAG, value: contentType })
  if (extra?.length) tags.push(...extra)
  return tags
}

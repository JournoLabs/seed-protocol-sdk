import { getPublicArweaveRawUrl } from './publicUrl.js'

/**
 * Path gateways for `ipfs://` ids when none is configured: the same two as `@seedprotocol/ipfs`'s
 * `DEFAULT_GATEWAYS`, both run by the IPFS Foundation. A URL written for a reader takes the first.
 */
export const DEFAULT_IPFS_GATEWAYS = ['https://ipfs.io', 'https://dweb.link']

export type PublicStorageUrlOptions = {
  /** Path gateway for `ipfs://<cid>` ids, e.g. `https://ipfs.example.com`. Default `DEFAULT_IPFS_GATEWAYS[0]`. */
  ipfsGateway?: string
}

const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//

/**
 * Whether a storage id is written as a URI (`ipfs://<cid>`), which a blob store other than Arweave
 * writes, rather than as an Arweave transaction id. Readers use such an id as it is: they don't
 * encode it, add `ar://` to it or build an Arweave `/raw/` URL from it.
 */
export function hasUriScheme(storageId: string): boolean {
  return SCHEME.test(storageId.trim())
}

/**
 * The URL a reader outside Seed loads a storage id from: `<gateway>/ipfs/<cid>` for `ipfs://<cid>`,
 * else the public Arweave gateway's `/raw/<id>` ({@link getPublicArweaveRawUrl}). Undefined for an
 * id with any other scheme, which has no gateway to map to.
 */
export function publicStorageUrl(storageId: string, options?: PublicStorageUrlOptions): string | undefined {
  const id = storageId.trim()
  if (!hasUriScheme(id)) return getPublicArweaveRawUrl(id)
  const match = /^ipfs:\/\/([^/?#]+)$/.exec(id)
  if (!match) return undefined
  const gateway = (options?.ipfsGateway?.trim() || DEFAULT_IPFS_GATEWAYS[0]!).replace(/\/+$/, '')
  return `${gateway}/ipfs/${match[1]}`
}

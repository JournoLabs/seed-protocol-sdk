import { parseCid, toHex } from './cid'
import { DEFAULT_GATEWAYS } from './gateway'

export type IpfsSourceOptions = {
  /** Path gateways to read from, tried in order. Defaults to {@link DEFAULT_GATEWAYS}. */
  gateways?: string[]
}

/** The CID of `ipfs://<cid>` or of a bare CID, or undefined when it isn't a base32 CIDv1 this package reads. */
function cidOf(storageId: string): string | undefined {
  const cid = storageId.startsWith('ipfs://') ? storageId.slice('ipfs://'.length) : storageId
  try {
    parseCid(cid)
    return cid
  } catch {
    return undefined
  }
}

/**
 * The SDK's read half for `ipfs://` storage ids (`SeedConfig.blobSources`, ADR 0026). Matches the
 * `BlobSource` interface in `@seedprotocol/sdk`:
 *
 * - `key` turns `ipfs://<cid>`, or the bare CID, into the CID (lowercase base32, so it can name a
 *   file); anything else is undefined.
 * - `urls` gives `<gateway>/ipfs/<cid>` for each gateway, in order.
 * - `sha256` gives the bytes' SHA-256 for a `raw` CID. A `dag-pb` root hashes the DAG, not the
 *   bytes, so files over 262144 bytes download unverified.
 */
export function ipfsBlobSource(options: IpfsSourceOptions = {}) {
  const gateways = (options.gateways ?? DEFAULT_GATEWAYS).map((g) => g.replace(/\/$/, ''))
  return {
    id: 'ipfs',
    key: (storageId: string): string | undefined => cidOf(storageId.trim()),
    urls: (key: string): string[] => {
      const cid = cidOf(key)
      return cid ? gateways.map((gateway) => `${gateway}/ipfs/${cid}`) : []
    },
    sha256: (key: string): string | undefined => {
      const cid = cidOf(key)
      if (!cid) return undefined
      const { codec, digest } = parseCid(cid)
      return codec === 'raw' ? toHex(digest) : undefined
    },
  }
}

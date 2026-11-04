import { parseCid, toHex } from './cid'

/** Path gateways read when none are configured. Both are run by the IPFS Foundation. */
export const DEFAULT_GATEWAYS = ['https://ipfs.io', 'https://dweb.link']

export type IpfsId = {
  cid: string
  codec: 'raw' | 'dag-pb'
  /**
   * Hex SHA-256 of the blob's bytes, for a `raw` CID (a blob of one block). A `dag-pb` root hashes
   * the DAG's root node, not the bytes, so it has none.
   */
  sha256?: string
}

/** The parts of an `ipfs://<cidv1>` storage id, or undefined for any other id. */
export function parseIpfsId(id: string): IpfsId | undefined {
  const match = /^ipfs:\/\/(b[a-z2-7]+)$/.exec(id)
  if (!match) return undefined
  try {
    const { codec, digest } = parseCid(match[1]!)
    return { cid: match[1]!, codec, ...(codec === 'raw' ? { sha256: toHex(digest) } : {}) }
  } catch {
    return undefined
  }
}

/**
 * Path-gateway URLs for an `ipfs://` storage id, one per gateway in the order given:
 * `<gateway>/ipfs/<cid>`. Empty for an id that isn't an `ipfs://` CIDv1.
 */
export function ipfsGatewayUrls(id: string, gateways: string[] = DEFAULT_GATEWAYS): string[] {
  const parsed = parseIpfsId(id)
  if (!parsed) return []
  return gateways.map((gateway) => `${gateway.replace(/\/$/, '')}/ipfs/${parsed.cid}`)
}

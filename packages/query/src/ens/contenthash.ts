import { varint } from 'multiformats'
import { base36 } from 'multiformats/bases/base36'
import { base64url } from 'multiformats/bases/base64'
import { CID } from 'multiformats/cid'

/** Contenthash namespaces (EIP-1577, multicodec table) this module decodes. */
const IPFS = 0xe3
const SWARM = 0xe4
const IPNS = 0xe5
const ARWEAVE = 0xb29910

const LIBP2P_KEY = 0x72
const IDENTITY = 0x00

export type EnsContenthashProtocol = 'ipfs' | 'ipns' | 'swarm' | 'arweave'

export type EnsContenthash = {
  protocol: EnsContenthashProtocol
  /**
   * The content id in its usual text form: a CIDv1 in base32 for `ipfs`; a base36 CID for an
   * `ipns` key, or the DNSLink domain for a legacy `ipns` record; the 32-byte hex hash for `swarm`;
   * the base64url transaction or manifest id for `arweave`.
   */
  value: string
  /** `ipfs://…`, `ipns://…`, `bzz://…` or `ar://…`. */
  uri: string
}

/**
 * Decodes an EIP-1577 contenthash: a multicodec namespace, then the content id. Returns `null`
 * for an empty contenthash (`0x` or no bytes). Throws a `TypeError` on a namespace not listed in
 * `EnsContenthashProtocol` or a content id that doesn't parse.
 */
export function decodeContenthash(contenthash: string | Uint8Array): EnsContenthash | null {
  const bytes = typeof contenthash === 'string' ? hexToBytes(contenthash) : contenthash
  if (bytes.length === 0) return null

  const [codec, codecLength] = varint.decode(bytes)
  const payload = bytes.subarray(codecLength)
  if (payload.length === 0) throw new TypeError(`Contenthash has codec 0x${codec.toString(16)} and no content id`)

  switch (codec) {
    case IPFS: {
      const value = decodeCid(payload).toV1().toString()
      return { protocol: 'ipfs', value, uri: `ipfs://${value}` }
    }
    case IPNS: {
      const cid = decodeCid(payload)
      const value =
        cid.code !== LIBP2P_KEY && cid.multihash.code === IDENTITY
          ? new TextDecoder().decode(cid.multihash.digest)
          : cid.toV1().toString(base36)
      return { protocol: 'ipns', value, uri: `ipns://${value}` }
    }
    case SWARM: {
      const value = bytesToHex(decodeCid(payload).multihash.digest)
      return { protocol: 'swarm', value, uri: `bzz://${value}` }
    }
    case ARWEAVE: {
      const value = base64url.baseEncode(payload)
      return { protocol: 'arweave', value, uri: `ar://${value}` }
    }
    default:
      throw new TypeError(`Contenthash codec 0x${codec.toString(16)} is not ipfs, ipns, swarm or arweave`)
  }
}

function decodeCid(bytes: Uint8Array) {
  try {
    return CID.decode(bytes)
  } catch (err) {
    throw new TypeError(`Contenthash content id is not a CID: ${(err as Error).message}`)
  }
}

function hexToBytes(hex: string): Uint8Array {
  const body = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex
  if (body.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(body)) {
    throw new TypeError(`Contenthash is not hex: ${hex}`)
  }
  const out = new Uint8Array(body.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(body.slice(i * 2, i * 2 + 2), 16)
  return out
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

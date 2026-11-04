/**
 * CIDv1 and UnixFS file DAGs, computed locally so a blob's id is known before it is uploaded.
 *
 * The layout is Kubo's for `ipfs add --cid-version=1 --raw-leaves --chunker=size-262144` with the
 * balanced layout (not `--trickle`), at most 174 links per node:
 *
 * - A blob of at most 262144 bytes is one `raw` block (codec 0x55); its CID is the bytes' sha2-256
 *   with a prefix, so it equals the upload's Content-SHA-256.
 * - A larger blob is cut into 262144-byte `raw` leaves, grouped left to right into `dag-pb` UnixFS
 *   File nodes of up to 174 children, level by level, until one root is left. The id is the root's
 *   CIDv1 (codec 0x70).
 *
 * The same bytes always give the same CID, and `ipfs add` with those flags reproduces it.
 */

export const CHUNK_SIZE = 262_144
export const MAX_LINKS = 174

const CODEC_RAW = 0x55
const CODEC_DAG_PB = 0x70
const SHA2_256 = 0x12

/** One block of a DAG: its CID's bytes and its encoded bytes. */
export type Block = { cid: Uint8Array; bytes: Uint8Array }

/** A blob's UnixFS DAG: the root CID as a string and every block, root first, depth first. */
export type UnixFsDag = { root: string; blocks: Block[] }

export function varint(n: number): number[] {
  const out: number[] = []
  while (n >= 0x80) {
    out.push((n % 0x80) | 0x80)
    n = Math.floor(n / 0x80)
  }
  out.push(n)
  return out
}

function concat(parts: (Uint8Array | number[])[]): Uint8Array {
  const length = parts.reduce((sum, p) => sum + p.length, 0)
  const out = new Uint8Array(length)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>))
}

export const toHex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

const cidBytes = (codec: number, digest: Uint8Array): Uint8Array =>
  concat([[0x01, ...varint(codec), SHA2_256, digest.length], digest])

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567'

/** Multibase base32 (RFC 4648, lowercase, no padding), with the `b` prefix. */
export function cidToString(cid: Uint8Array): string {
  let out = 'b'
  let bits = 0
  let value = 0
  for (const byte of cid) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31]
  return out
}

/** Parsed CIDv1 string. Throws on anything but a base32 CIDv1 with a sha2-256 multihash. */
export function parseCid(cid: string): { codec: 'raw' | 'dag-pb'; digest: Uint8Array } {
  if (!/^b[a-z2-7]+$/.test(cid)) throw new Error(`Not a base32 CIDv1: ${cid}`)
  const bytes: number[] = []
  let bits = 0
  let value = 0
  for (const char of cid.slice(1)) {
    value = ((value << 5) | BASE32.indexOf(char)) & 0xffff
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  const [version, codec, hash, length] = bytes
  if (version !== 0x01 || (codec !== CODEC_RAW && codec !== CODEC_DAG_PB) || hash !== SHA2_256 || length !== 32 || bytes.length !== 36) {
    throw new Error(`Not a raw or dag-pb CIDv1 with a sha2-256 multihash: ${cid}`)
  }
  return { codec: codec === CODEC_RAW ? 'raw' : 'dag-pb', digest: new Uint8Array(bytes.slice(4)) }
}

// Protobuf: a field key is (field number << 3) | wire type; 0 = varint, 2 = length-delimited.
const pbVarint = (field: number, n: number) => [(field << 3) | 0, ...varint(n)]
const pbBytes = (field: number, bytes: Uint8Array) => concat([[(field << 3) | 2, ...varint(bytes.length)], bytes])

/** UnixFS `Data` for a File node with children: Type = File, filesize, one blocksize per child. */
const unixFsFile = (fileSize: number, blockSizes: number[]) =>
  concat([pbVarint(1, 2), pbVarint(3, fileSize), ...blockSizes.map((size) => pbVarint(4, size))])

type Child = { cid: Uint8Array; fileSize: number; tsize: number }

/** dag-pb node: links (field 2) before data (field 1), as the canonical encoding orders them. */
function dagPbNode(children: Child[], data: Uint8Array): Uint8Array {
  const links = children.map((c) =>
    pbBytes(2, concat([pbBytes(1, c.cid), pbBytes(2, new Uint8Array()), pbVarint(3, c.tsize)])),
  )
  return concat([...links, pbBytes(1, data)])
}

/**
 * The UnixFS DAG of `bytes` (see the file header for the layout). Blocks hold copies of the leaves,
 * so a large blob is in memory twice while its DAG is.
 */
export async function unixFsDag(bytes: Uint8Array): Promise<UnixFsDag> {
  if (bytes.length <= CHUNK_SIZE) {
    const cid = cidBytes(CODEC_RAW, await sha256(bytes))
    return { root: cidToString(cid), blocks: [{ cid, bytes }] }
  }

  // Each level's nodes keep their subtree's blocks, so the result can be written root first.
  type Node = Child & { blocks: Block[] }
  let level: Node[] = []
  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    const leaf = bytes.subarray(offset, offset + CHUNK_SIZE)
    const cid = cidBytes(CODEC_RAW, await sha256(leaf))
    level.push({ cid, fileSize: leaf.length, tsize: leaf.length, blocks: [{ cid, bytes: leaf }] })
  }
  while (level.length > 1) {
    const next: Node[] = []
    for (let i = 0; i < level.length; i += MAX_LINKS) {
      const children = level.slice(i, i + MAX_LINKS)
      const fileSize = children.reduce((sum, c) => sum + c.fileSize, 0)
      const node = dagPbNode(children, unixFsFile(fileSize, children.map((c) => c.fileSize)))
      const cid = cidBytes(CODEC_DAG_PB, await sha256(node))
      next.push({
        cid,
        fileSize,
        tsize: node.length + children.reduce((sum, c) => sum + c.tsize, 0),
        blocks: [{ cid, bytes: node }, ...children.flatMap((c) => c.blocks)],
      })
    }
    level = next
  }
  const root = level[0]!
  return { root: cidToString(root.cid), blocks: root.blocks }
}

/** CIDv1 of `bytes` as {@link unixFsDag} computes it, without keeping the blocks. */
export async function computeCid(bytes: Uint8Array): Promise<string> {
  return (await unixFsDag(bytes)).root
}

/**
 * CARv1 of a DAG: a dag-cbor header `{ roots: [root], version: 1 }`, then each block as
 * varint(length) + CID + bytes, in the DAG's order with repeated blocks written once.
 */
export function toCar(dag: UnixFsDag): Uint8Array {
  const root = dag.blocks[0]!.cid
  // dag-cbor: map(2), "roots" → [tag 42 (CID): bytes(0x00 + cid)], "version" → 1. Keys sort by length.
  const cidField = concat([[0xd8, 0x2a], cborBytesHeader(root.length + 1), [0x00], root])
  const header = concat([
    [0xa2, 0x65],
    new TextEncoder().encode('roots'),
    [0x81],
    cidField,
    [0x67],
    new TextEncoder().encode('version'),
    [0x01],
  ])
  const parts: (Uint8Array | number[])[] = [varint(header.length), header]
  const seen = new Set<string>()
  for (const block of dag.blocks) {
    const key = toHex(block.cid)
    if (seen.has(key)) continue
    seen.add(key)
    parts.push(varint(block.cid.length + block.bytes.length), block.cid, block.bytes)
  }
  return concat(parts)
}

function cborBytesHeader(length: number): number[] {
  if (length < 24) return [0x40 + length]
  if (length < 256) return [0x58, length]
  return [0x59, length >> 8, length & 0xff]
}

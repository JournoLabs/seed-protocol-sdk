import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { cidToString, sha256, toHex } from '../src/cid'

/**
 * Bytes from the LCG x = (x * 1103515245 + 12345) mod 2^31, one byte (x >> 16) & 0xff per step.
 * The Kubo vectors in cid.test.ts were made from the same bytes.
 */
export function lcgBytes(length: number, seed: number): Uint8Array {
  const out = new Uint8Array(length)
  let x = seed
  for (let i = 0; i < length; i++) {
    x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff
    out[i] = (x >>> 16) & 0xff
  }
  return out
}

function readVarint(bytes: Uint8Array, offset: number): [number, number] {
  let value = 0
  let shift = 1
  for (;;) {
    const byte = bytes[offset++]!
    value += (byte & 0x7f) * shift
    if (byte < 0x80) return [value, offset]
    shift *= 128
  }
}

/** Blocks of a CARv1, each checked against its CID's sha2-256. Throws on a block that doesn't match. */
export async function readCar(car: Uint8Array): Promise<{ cids: string[] }> {
  let [length, offset] = readVarint(car, 0)
  offset += length
  const cids: string[] = []
  while (offset < car.length) {
    ;[length, offset] = readVarint(car, offset)
    const end = offset + length
    // CIDv1 with a one-byte codec and a 32-byte sha2-256 digest: 36 bytes.
    const cid = car.subarray(offset, offset + 36)
    const digest = await sha256(car.subarray(offset + 36, end))
    if (toHex(digest) !== toHex(cid.subarray(4))) throw new Error('CAR block does not match its CID')
    cids.push(cidToString(cid))
    offset = end
  }
  return { cids }
}

export type MockIpfs = {
  url: string
  /** Roots pinned through Kubo's dag/import or Pinata's upload. */
  pinned: Set<string>
  /** Every request, as `METHOD path`. */
  requests: string[]
  /** Pinata uploads: their form fields other than the file, and the Authorization header. */
  pinataUploads: { fields: Record<string, string>; authorization?: string }[]
  /** Next dag/import's PinErrorMsg, once. */
  failNextPin?: string
  /** Pinata answers with this cid instead of the CAR's root. */
  pinataCid?: string
  /** Gateway HEADs answer 404 for pinned roots until this many have been made. */
  gatewayDelay: number
  close(): Promise<void>
}

const body = (req: IncomingMessage) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })

/** A Kubo RPC, Pinata upload API and path gateway on 127.0.0.1, sharing one pin set. */
export async function startMockIpfs(): Promise<MockIpfs> {
  let gatewayHeads = 0
  const state = {
    pinned: new Set<string>(),
    requests: [] as string[],
    pinataUploads: [] as MockIpfs['pinataUploads'],
    gatewayDelay: 0,
  } as MockIpfs

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://127.0.0.1')
    state.requests.push(`${req.method} ${url.pathname}`)
    const raw = await body(req)
    const form = async () =>
      new Request(url, { method: 'POST', headers: req.headers as Record<string, string>, body: new Uint8Array(raw) }).formData()

    if (url.pathname === '/api/v0/dag/import') {
      const file = (await form()).get('file') as Blob
      const { cids } = await readCar(new Uint8Array(await file.arrayBuffer()))
      const root = cids[0]!
      if (url.searchParams.get('pin-roots') === 'true') state.pinned.add(root)
      const error = state.failNextPin ?? ''
      state.failNextPin = undefined
      if (error) state.pinned.delete(root)
      res.end(JSON.stringify({ Root: { Cid: { '/': root }, PinErrorMsg: error } }) + '\n')
      return
    }
    if (url.pathname === '/api/v0/pin/ls') {
      const cid = url.searchParams.get('arg')!
      if (state.pinned.has(cid)) {
        res.end(JSON.stringify({ Keys: { [cid]: { Type: 'recursive' } } }))
      } else {
        res.statusCode = 500
        res.end(JSON.stringify({ Message: `path '${cid}' is not pinned`, Code: 0, Type: 'error' }))
      }
      return
    }
    if (url.pathname === '/v3/files') {
      const data = await form()
      const fields: Record<string, string> = {}
      for (const [key, value] of data) if (typeof value === 'string') fields[key] = value
      state.pinataUploads.push({ fields, authorization: req.headers.authorization })
      const { cids } = await readCar(new Uint8Array(await (data.get('file') as Blob).arrayBuffer()))
      state.pinned.add(cids[0]!)
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ data: { id: 'f1', cid: state.pinataCid ?? cids[0] } }))
      return
    }
    const gateway = /^\/ipfs\/([a-z0-9]+)$/.exec(url.pathname)
    if (gateway && req.method === 'HEAD') {
      gatewayHeads++
      res.statusCode = state.pinned.has(gateway[1]!) && gatewayHeads > state.gatewayDelay ? 200 : 404
      res.end()
      return
    }
    res.statusCode = 404
    res.end()
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  state.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  state.close = () => new Promise((resolve) => server.close(() => resolve()))
  return state
}

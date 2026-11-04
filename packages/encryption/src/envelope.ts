/**
 * The `seed-private/v1` envelope: an age-style header of recipient stanzas, authenticated with an
 * HMAC under the file key, followed by a chunked AES-256-GCM payload. SPEC.md is the normative
 * description; this file implements it with WebCrypto only.
 */

import { decodeBase64NoPad, encodeBase64NoPad } from './base64'

export const ENVELOPE_FORMAT = 'seed-private/v1'
/** Content-Type for an uploaded envelope. The real type is inside the encrypted payload. */
export const ENVELOPE_CONTENT_TYPE = 'application/octet-stream'
/** Upload tag that marks an envelope, so readers know to decrypt before sniffing. */
export const ENVELOPE_FORMAT_TAG = { name: 'Seed-Encryption', value: ENVELOPE_FORMAT } as const

export const FILE_KEY_LENGTH = 32
export const CHUNK_SIZE = 64 * 1024
const TAG_LENGTH = 16
const PAYLOAD_NONCE_LENGTH = 16
const BODY_LINE_LENGTH = 64
const MAX_CONTENT_META_LENGTH = 64 * 1024

const VERSION_LINE = `${ENVELOPE_FORMAT}\n`
const HEADER_INFO = `${ENVELOPE_FORMAT}/header`
const PAYLOAD_INFO = `${ENVELOPE_FORMAT}/payload`

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

export type EnvelopeErrorCode =
  | 'NOT_ENVELOPE'
  | 'BAD_HEADER'
  | 'BAD_BIND'
  | 'BIND_MISMATCH'
  | 'NO_KEY'
  | 'BAD_FILE_KEY'
  | 'HEADER_MAC'
  | 'TRUNCATED'
  | 'BAD_CHUNK'
  | 'TRAILING_DATA'
  | 'BAD_CONTENT_FRAME'

export class EnvelopeError extends Error {
  readonly code: EnvelopeErrorCode
  constructor(code: EnvelopeErrorCode, message: string) {
    super(message)
    this.name = 'EnvelopeError'
    this.code = code
  }
}

/** One recipient's wrap of the file key. Types are defined in SPEC.md; this layer treats them as opaque. */
export interface Stanza {
  type: string
  args: string[]
  body: Uint8Array
}

/**
 * Values the envelope is bound to, known before upload. `envelopeId` is required and is recorded
 * in the envelope attestation, so a ciphertext can't be presented as another Version's.
 */
export type EnvelopeBind = { envelopeId: string } & Record<string, string>

export interface EnvelopeHeader {
  bind: EnvelopeBind
  stanzas: Stanza[]
}

export interface EncryptEnvelopeInput {
  /** 32 random bytes, from `generateFileKey()`. One per private Version. */
  fileKey: Uint8Array
  bind: EnvelopeBind
  /** At least one. Always include the publisher's own wrap. */
  stanzas: Stanza[]
  /** The plaintext's real MIME type; stored inside the encrypted payload. */
  contentType: string
  body: Uint8Array
}

export interface DecryptEnvelopeOptions {
  /** The file key, when the caller already unwrapped it. */
  fileKey?: Uint8Array
  /** Called with the parsed header when `fileKey` is not given; returns the unwrapped file key or null. */
  unwrap?: (header: EnvelopeHeader) => Promise<Uint8Array | null> | Uint8Array | null
  /** Every key given must equal the envelope's bind value, or decryption fails with BIND_MISMATCH. */
  expectBind?: Partial<EnvelopeBind>
}

export interface DecryptedEnvelope {
  bind: EnvelopeBind
  contentType: string
  body: Uint8Array
}

const BIND_KEY = /^[A-Za-z][A-Za-z0-9]*$/
const ENVELOPE_ID = /^0x[0-9a-f]{64}$/
const STANZA_ARG = /^[\x21-\x7e]+$/

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(length)
  crypto.getRandomValues(out)
  return out
}

export function generateFileKey(): Uint8Array {
  return randomBytes(FILE_KEY_LENGTH)
}

/** A random `0x`-prefixed 32-byte hex id, chosen before encryption and attested with the Version. */
export function generateEnvelopeId(): string {
  return `0x${Array.from(randomBytes(32), (b) => b.toString(16).padStart(2, '0')).join('')}`
}

/** True when `bytes` start with the envelope's version line. Doesn't validate the rest. */
export function isEnvelope(bytes: Uint8Array): boolean {
  if (bytes.length < VERSION_LINE.length) return false
  for (let i = 0; i < VERSION_LINE.length; i++) {
    if (bytes[i] !== VERSION_LINE.charCodeAt(i)) return false
  }
  return true
}

/** Sorted keys, string values, no whitespace. The bytes feed the payload key derivation. */
export function canonicalBind(bind: EnvelopeBind): string {
  const keys = Object.keys(bind).sort()
  for (const key of keys) {
    if (!BIND_KEY.test(key)) throw new EnvelopeError('BAD_BIND', `Invalid bind key ${JSON.stringify(key)}`)
    if (typeof bind[key] !== 'string') throw new EnvelopeError('BAD_BIND', `Bind value for ${key} must be a string`)
  }
  if (!ENVELOPE_ID.test(bind.envelopeId ?? '')) {
    throw new EnvelopeError('BAD_BIND', 'bind.envelopeId must be 0x followed by 64 lowercase hex digits')
  }
  return JSON.stringify(Object.fromEntries(keys.map((k) => [k, bind[k]])))
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

function copy(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes)
}

async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', copy(ikm), 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: copy(salt), info: copy(info) },
    key,
    length * 8,
  )
  return new Uint8Array(bits)
}

async function headerMacKey(fileKey: Uint8Array, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  const raw = await hkdf(fileKey, new Uint8Array(0), encoder.encode(HEADER_INFO), 32)
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, [usage])
}

async function payloadKey(fileKey: Uint8Array, nonce: Uint8Array, bindText: string, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  const info = concat([encoder.encode(PAYLOAD_INFO), new Uint8Array([0]), encoder.encode(bindText)])
  const raw = await hkdf(fileKey, nonce, info, 32)
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, [usage])
}

function chunkNonce(index: number, last: boolean): Uint8Array<ArrayBuffer> {
  const iv = new Uint8Array(12)
  // 11-byte big-endian counter; indexes stay below 2^53, so the top bytes are zero.
  let n = index
  for (let i = 10; i >= 0 && n > 0; i--) {
    iv[i] = n % 256
    n = Math.floor(n / 256)
  }
  iv[11] = last ? 1 : 0
  return iv
}

function encodeContentFrame(contentType: string, body: Uint8Array): Uint8Array<ArrayBuffer> {
  const meta = encoder.encode(JSON.stringify({ contentType }))
  const len = new Uint8Array(4)
  new DataView(len.buffer).setUint32(0, meta.length)
  return concat([len, meta, body])
}

function decodeContentFrame(plain: Uint8Array): { contentType: string; body: Uint8Array } {
  if (plain.length < 4) throw new EnvelopeError('BAD_CONTENT_FRAME', 'Payload is shorter than its content frame')
  const metaLength = new DataView(plain.buffer, plain.byteOffset, 4).getUint32(0)
  if (metaLength > MAX_CONTENT_META_LENGTH || 4 + metaLength > plain.length) {
    throw new EnvelopeError('BAD_CONTENT_FRAME', 'Content metadata length is out of range')
  }
  let meta: unknown
  try {
    meta = JSON.parse(decoder.decode(plain.subarray(4, 4 + metaLength)))
  } catch {
    throw new EnvelopeError('BAD_CONTENT_FRAME', 'Content metadata is not UTF-8 JSON')
  }
  const contentType = (meta as { contentType?: unknown } | null)?.contentType
  if (typeof contentType !== 'string') throw new EnvelopeError('BAD_CONTENT_FRAME', 'Content metadata has no contentType')
  return { contentType, body: plain.subarray(4 + metaLength) }
}

function encodeStanza(stanza: Stanza): string {
  if (!STANZA_ARG.test(stanza.type) || stanza.args.some((a) => !STANZA_ARG.test(a))) {
    throw new EnvelopeError('BAD_HEADER', 'Stanza type and arguments must be non-empty printable ASCII without spaces')
  }
  const b64 = encodeBase64NoPad(stanza.body)
  let lines = ''
  for (let i = 0; i <= b64.length; i += BODY_LINE_LENGTH) {
    // The final line is shorter than 64 characters, and empty when the body fills its last line.
    lines += `${b64.slice(i, i + BODY_LINE_LENGTH)}\n`
  }
  return `-> ${[stanza.type, ...stanza.args].join(' ')}\n${lines}`
}

/** The header through `---`, which the MAC covers. */
function headerPrefix(bindText: string, stanzas: Stanza[]): string {
  if (stanzas.length === 0) throw new EnvelopeError('BAD_HEADER', 'An envelope needs at least one stanza')
  return `${VERSION_LINE}bind ${encodeBase64NoPad(encoder.encode(bindText))}\n${stanzas.map(encodeStanza).join('')}---`
}

/** Encrypt with a caller-chosen payload nonce. Exported for test vectors only; use `encryptEnvelope`. */
export async function encryptEnvelopeWithNonce(input: EncryptEnvelopeInput, payloadNonce: Uint8Array): Promise<Uint8Array> {
  if (input.fileKey.length !== FILE_KEY_LENGTH) throw new EnvelopeError('BAD_FILE_KEY', `File key must be ${FILE_KEY_LENGTH} bytes`)
  if (payloadNonce.length !== PAYLOAD_NONCE_LENGTH) throw new EnvelopeError('BAD_HEADER', 'Payload nonce must be 16 bytes')
  const bindText = canonicalBind(input.bind)
  const prefix = encoder.encode(headerPrefix(bindText, input.stanzas))
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await headerMacKey(input.fileKey, 'sign'), prefix))

  const key = await payloadKey(input.fileKey, payloadNonce, bindText, 'encrypt')
  const plain = encodeContentFrame(input.contentType, input.body)
  const chunks: Uint8Array[] = []
  const count = Math.max(1, Math.ceil(plain.length / CHUNK_SIZE))
  for (let i = 0; i < count; i++) {
    const part = plain.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
    const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: chunkNonce(i, i === count - 1) }, key, part)
    chunks.push(new Uint8Array(sealed))
  }
  return concat([prefix, encoder.encode(` ${encodeBase64NoPad(mac)}\n`), payloadNonce, ...chunks])
}

export function encryptEnvelope(input: EncryptEnvelopeInput): Promise<Uint8Array> {
  return encryptEnvelopeWithNonce(input, randomBytes(PAYLOAD_NONCE_LENGTH))
}

interface ParsedHeader extends EnvelopeHeader {
  bindText: string
  /** Bytes through `---`, covered by the MAC. */
  macInput: Uint8Array
  mac: Uint8Array
  payloadOffset: number
}

function readLine(bytes: Uint8Array, start: number): { line: string; next: number } {
  const end = bytes.indexOf(0x0a, start)
  if (end < 0) throw new EnvelopeError('BAD_HEADER', 'Header ends without a newline')
  let line: string
  try {
    line = decoder.decode(bytes.subarray(start, end))
  } catch {
    throw new EnvelopeError('BAD_HEADER', 'Header is not UTF-8')
  }
  if (!/^[\x20-\x7e]*$/.test(line)) throw new EnvelopeError('BAD_HEADER', 'Header lines must be printable ASCII')
  return { line, next: end + 1 }
}

function parse(bytes: Uint8Array): ParsedHeader {
  if (!isEnvelope(bytes)) throw new EnvelopeError('NOT_ENVELOPE', `Bytes do not start with ${ENVELOPE_FORMAT}`)
  let pos = VERSION_LINE.length

  let r = readLine(bytes, pos)
  if (!r.line.startsWith('bind ')) throw new EnvelopeError('BAD_HEADER', 'Missing bind line')
  const bindBytes = decodeBase64NoPad(r.line.slice(5))
  if (!bindBytes) throw new EnvelopeError('BAD_HEADER', 'bind line is not canonical base64')
  let bindText: string
  let bind: EnvelopeBind
  try {
    bindText = decoder.decode(bindBytes)
    bind = JSON.parse(bindText) as EnvelopeBind
  } catch {
    throw new EnvelopeError('BAD_BIND', 'bind is not UTF-8 JSON')
  }
  if (bind === null || typeof bind !== 'object' || Array.isArray(bind) || canonicalBind(bind) !== bindText) {
    throw new EnvelopeError('BAD_BIND', 'bind is not canonical')
  }
  pos = r.next

  const stanzas: Stanza[] = []
  for (;;) {
    r = readLine(bytes, pos)
    if (r.line.startsWith('--- ')) break
    if (!r.line.startsWith('-> ')) throw new EnvelopeError('BAD_HEADER', 'Expected a stanza or the MAC line')
    const [type, ...args] = r.line.slice(3).split(' ')
    if (!type || !STANZA_ARG.test(type) || args.some((a) => !STANZA_ARG.test(a))) {
      throw new EnvelopeError('BAD_HEADER', 'Malformed stanza line')
    }
    pos = r.next
    let b64 = ''
    for (;;) {
      r = readLine(bytes, pos)
      pos = r.next
      if (r.line.length > BODY_LINE_LENGTH) throw new EnvelopeError('BAD_HEADER', 'Stanza body line is too long')
      b64 += r.line
      if (r.line.length < BODY_LINE_LENGTH) break
    }
    const body = decodeBase64NoPad(b64)
    if (!body) throw new EnvelopeError('BAD_HEADER', 'Stanza body is not canonical base64')
    stanzas.push({ type, args, body })
  }
  if (stanzas.length === 0) throw new EnvelopeError('BAD_HEADER', 'Envelope has no stanzas')

  const mac = decodeBase64NoPad(r.line.slice(4))
  if (!mac || mac.length !== 32) throw new EnvelopeError('BAD_HEADER', 'MAC is not 32 bytes of canonical base64')
  return { bind, bindText, stanzas, macInput: bytes.subarray(0, pos + 3), mac, payloadOffset: r.next }
}

/** Reads the bind values and stanzas without a key, so a reader can pick the stanza to unwrap. */
export function parseEnvelopeHeader(bytes: Uint8Array): EnvelopeHeader {
  const { bind, stanzas } = parse(bytes)
  return { bind, stanzas }
}

export async function decryptEnvelope(bytes: Uint8Array, options: DecryptEnvelopeOptions): Promise<DecryptedEnvelope> {
  const header = parse(bytes)
  for (const [key, value] of Object.entries(options.expectBind ?? {})) {
    if (header.bind[key] !== value) throw new EnvelopeError('BIND_MISMATCH', `Envelope bind ${key} does not match`)
  }
  const fileKey = options.fileKey ?? (await options.unwrap?.({ bind: header.bind, stanzas: header.stanzas }))
  if (!fileKey) throw new EnvelopeError('NO_KEY', 'No stanza could be unwrapped')
  if (fileKey.length !== FILE_KEY_LENGTH) throw new EnvelopeError('BAD_FILE_KEY', `File key must be ${FILE_KEY_LENGTH} bytes`)

  const macOk = await crypto.subtle.verify('HMAC', await headerMacKey(fileKey, 'verify'), copy(header.mac), copy(header.macInput))
  if (!macOk) throw new EnvelopeError('HEADER_MAC', 'Header MAC does not verify; wrong key or altered header')

  const payload = bytes.subarray(header.payloadOffset)
  if (payload.length < PAYLOAD_NONCE_LENGTH + TAG_LENGTH) throw new EnvelopeError('TRUNCATED', 'Payload is truncated')
  const key = await payloadKey(fileKey, payload.subarray(0, PAYLOAD_NONCE_LENGTH), header.bindText, 'decrypt')

  const sealedChunk = CHUNK_SIZE + TAG_LENGTH
  const parts: Uint8Array[] = []
  let pos = PAYLOAD_NONCE_LENGTH
  for (let i = 0; ; i++) {
    const remaining = payload.length - pos
    if (remaining < TAG_LENGTH) throw new EnvelopeError('TRUNCATED', 'Payload ends without a final chunk')
    const last = remaining <= sealedChunk
    const chunk = copy(payload.subarray(pos, pos + Math.min(remaining, sealedChunk)))
    let plain: Uint8Array
    try {
      plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: chunkNonce(i, last) }, key, chunk))
    } catch {
      if (last && remaining === sealedChunk) {
        // A full-size chunk that fails as the last one may be a non-final chunk whose successor was cut off.
        try {
          await crypto.subtle.decrypt({ name: 'AES-GCM', iv: chunkNonce(i, false) }, key, chunk)
        } catch {
          throw new EnvelopeError('BAD_CHUNK', `Chunk ${i} does not authenticate`)
        }
        throw new EnvelopeError('TRUNCATED', 'Payload ends without a final chunk')
      }
      if (!last) {
        // A chunk sealed as final followed by more bytes.
        try {
          await crypto.subtle.decrypt({ name: 'AES-GCM', iv: chunkNonce(i, true) }, key, chunk)
        } catch {
          throw new EnvelopeError('BAD_CHUNK', `Chunk ${i} does not authenticate`)
        }
        throw new EnvelopeError('TRAILING_DATA', 'Bytes follow the final chunk')
      }
      throw new EnvelopeError('BAD_CHUNK', `Chunk ${i} does not authenticate`)
    }
    if (last && plain.length === 0 && i > 0) throw new EnvelopeError('BAD_CHUNK', 'The final chunk is empty')
    parts.push(plain)
    pos += chunk.length
    if (last) break
  }
  const { contentType, body } = decodeContentFrame(concat(parts))
  return { bind: header.bind, contentType, body }
}

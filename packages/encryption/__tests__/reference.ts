/**
 * A second implementation of SPEC.md's encryption, written against node:crypto and sharing no
 * code with src/. The vectors were produced with it, and the tests check src/ against both.
 */
import { createCipheriv, createHmac, hkdfSync } from 'node:crypto'

export interface ReferenceStanza {
  type: string
  args: string[]
  body: Buffer
}

export interface ReferenceInput {
  fileKey: Buffer
  bind: Record<string, string>
  stanzas: ReferenceStanza[]
  contentType: string
  body: Buffer
  payloadNonce: Buffer
  padding?: 'padme' | 'none'
  /** Replaces the content frame, to build envelopes whose plaintext src/ would never produce. */
  plaintext?: Buffer
}

/** PADMÉ, written from the paper's definition with logarithms rather than src/'s loops. */
export function referencePadme(length: number): number {
  if (length < 2) return length
  const e = Math.floor(Math.log2(length))
  const s = Math.floor(Math.log2(e)) + 1
  const mask = 2 ** (e - s) - 1
  return Number((BigInt(length) + BigInt(mask)) & ~BigInt(mask))
}

const b64 = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/, '')

function stanzaText({ type, args, body }: ReferenceStanza): string {
  const encoded = b64(body)
  const lines: string[] = []
  for (let i = 0; i <= encoded.length; i += 64) lines.push(encoded.slice(i, i + 64))
  return `-> ${[type, ...args].join(' ')}\n${lines.join('\n')}\n`
}

export function referenceEncrypt(input: ReferenceInput): Buffer {
  const bindText = JSON.stringify(Object.fromEntries(Object.keys(input.bind).sort().map((k) => [k, input.bind[k]])))
  const prefix = Buffer.from(
    `seed-private/v1\nbind ${b64(Buffer.from(bindText))}\n${input.stanzas.map(stanzaText).join('')}---`,
  )
  const macKey = Buffer.from(hkdfSync('sha256', input.fileKey, Buffer.alloc(0), 'seed-private/v1/header', 32))
  const mac = createHmac('sha256', macKey).update(prefix).digest()

  const info = Buffer.concat([Buffer.from('seed-private/v1/payload'), Buffer.from([0]), Buffer.from(bindText)])
  const key = Buffer.from(hkdfSync('sha256', input.fileKey, input.payloadNonce, info, 32))
  const meta = Buffer.from(JSON.stringify({ bodyLength: input.body.length, contentType: input.contentType }))
  const len = Buffer.alloc(4)
  len.writeUInt32BE(meta.length)
  const unpadded = 4 + meta.length + input.body.length
  const padded = (input.padding ?? 'padme') === 'padme' ? referencePadme(unpadded) : unpadded
  const plain = input.plaintext ?? Buffer.concat([len, meta, input.body, Buffer.alloc(padded - unpadded)])

  const chunks: Buffer[] = []
  const count = Math.max(1, Math.ceil(plain.length / 65536))
  for (let i = 0; i < count; i++) {
    const iv = Buffer.alloc(12)
    iv.writeUIntBE(i, 5, 6)
    iv[11] = i === count - 1 ? 1 : 0
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    chunks.push(cipher.update(plain.subarray(i * 65536, (i + 1) * 65536)), cipher.final(), cipher.getAuthTag())
  }
  return Buffer.concat([prefix, Buffer.from(` ${b64(mac)}\n`), input.payloadNonce, ...chunks])
}

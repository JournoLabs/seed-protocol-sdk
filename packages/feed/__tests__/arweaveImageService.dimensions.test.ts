import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BaseArweaveClient, resetArweaveReadGatewayForTests } from '@seedprotocol/arweave'
import { ArweaveImageService } from '../src/services/arweaveImageService'

const TX = 'JYeiPzuglpwr4cMRmCDFFmROnzXwdrDZAzg8vaZZRpY'

/** PNG signature followed by an IHDR chunk for a width x height image. */
function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33)
  const view = new DataView(bytes.buffer)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  view.setUint32(8, 13)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12) // IHDR
  view.setUint32(16, width)
  view.setUint32(20, height)
  bytes.set([8, 6, 0, 0, 0], 24)
  return bytes
}

/** GIF89a header with a logical screen of width x height. */
function gifHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(13)
  const view = new DataView(bytes.buffer)
  bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0)
  view.setUint16(6, width, true)
  view.setUint16(8, height, true)
  return bytes
}

function serveImage(body: Uint8Array, contentType: string) {
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (String(url).endsWith('/info')) {
      return new Response(JSON.stringify({ network: 'arweave.mainnet' }), { status: 200 })
    }
    if (init?.method === 'HEAD') {
      return new Response(null, {
        status: 200,
        headers: { 'content-type': contentType, 'content-length': String(body.length) },
      })
    }
    return new Response(body, { status: 206, headers: { 'content-type': contentType } })
  })
}

describe('ArweaveImageService image dimensions', () => {
  beforeEach(() => {
    resetArweaveReadGatewayForTests()
    BaseArweaveClient.setPreferredReadGateway('arweave.net')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetArweaveReadGatewayForTests()
  })

  it('reads width and height from a PNG header', async () => {
    vi.stubGlobal('fetch', serveImage(pngHeader(640, 480), 'image/png'))
    const service = new ArweaveImageService({ gateways: ['arweave.net'], timeout: 5_000 })

    const meta = (await service.detectImage(TX))!

    expect(meta.width).toBe(640)
    expect(meta.height).toBe(480)
    expect(meta.format).toBe('png')
  })

  it('reads width and height from a GIF header', async () => {
    vi.stubGlobal('fetch', serveImage(gifHeader(320, 200), 'image/gif'))
    const service = new ArweaveImageService({ gateways: ['arweave.net'], timeout: 5_000 })

    const meta = (await service.detectImage(TX))!

    expect(meta.width).toBe(320)
    expect(meta.height).toBe(200)
    expect(meta.format).toBe('gif')
  })

  it('takes the format from the bytes when the content type does not name one', async () => {
    vi.stubGlobal('fetch', serveImage(pngHeader(16, 16), 'image/'))
    const service = new ArweaveImageService({ gateways: ['arweave.net'], timeout: 5_000 })

    const meta = await service.detectImage(TX)

    expect(meta?.format).toBe('png')
  })

  it('reports 0 x 0 for bytes that are not a known image format', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', serveImage(new Uint8Array([1, 2, 3, 4]), 'image/png'))
    const service = new ArweaveImageService({ gateways: ['arweave.net'], timeout: 5_000 })

    const meta = (await service.detectImage(TX))!

    expect(meta.width).toBe(0)
    expect(meta.height).toBe(0)
  })
})

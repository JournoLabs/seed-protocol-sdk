import { afterEach, describe, expect, it, vi } from 'vitest'
import imageResize from '@/browser/workers/imageResize'

/**
 * Runs the resize worker source in this realm on one file with no MIME type, and returns the type
 * it inferred: the type of the blob handed to createImageBitmap (stubbed to stop there).
 */
async function inferredType(bytes: number[]): Promise<string | undefined> {
  const file = new File([new Uint8Array(bytes)], 'image')
  const root = {
    entries: async function* () {
      yield ['image', { kind: 'file', getFile: async () => file }]
    },
  }
  let type: string | undefined
  vi.stubGlobal('navigator', { storage: { getDirectory: async () => root } })
  vi.stubGlobal('postMessage', () => {})
  vi.stubGlobal('createImageBitmap', async (blob: Blob) => {
    type = blob.type
    throw new Error('stop')
  })

  // The worker source assigns the global `onmessage`.
  new Function(imageResize)()
  await (globalThis as any).onmessage({ data: { filePath: '/image', width: 480, height: 480, debug: true } })
  return type
}

const ascii = (s: string) => Array.from(s).map((c) => c.charCodeAt(0))

describe.skipIf(typeof window !== 'undefined')('imageResize worker MIME sniffing', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete (globalThis as any).onmessage
  })

  it('labels an untyped WebP (RIFF....WEBP) image/webp', async () => {
    expect(await inferredType([...ascii('RIFF'), 0x24, 0, 0, 0, ...ascii('WEBPVP8 ')])).toBe('image/webp')
  })

  it('labels an untyped PNG image/png', async () => {
    expect(await inferredType([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])).toBe('image/png')
  })

  it('a RIFF file that is not WebP is not labelled image/webp', async () => {
    expect(await inferredType([...ascii('RIFF'), 0x24, 0, 0, 0, ...ascii('WAVEfmt ')])).toBe('image/jpeg')
  })
})

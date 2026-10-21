import { describe, expect, it } from 'vitest'
import {
  EXTENSION_TO_MIME,
  MIME_TO_EXTENSION,
  getExtensionForMimeType,
  getMimeTypeFromPath,
  resolveUploadMimeType,
  sniffMimeType,
} from '@/helpers/mimeTypes'
import filesDownload from '@/browser/workers/filesDownload'

const ascii = (s: string) => Array.from(s).map((c) => c.charCodeAt(0))

describe('mimeTypes', () => {
  it('knows documents, audio, video and images by extension', () => {
    expect(getMimeTypeFromPath('/files/files/report.PDF')).toBe('application/pdf')
    expect(getMimeTypeFromPath('notes.md')).toBe('text/markdown')
    expect(getMimeTypeFromPath('data.csv')).toBe('text/csv')
    expect(getMimeTypeFromPath('song.mp3')).toBe('audio/mpeg')
    expect(getMimeTypeFromPath('clip.wav')).toBe('audio/wav')
    expect(getMimeTypeFromPath('clip.ogg')).toBe('audio/ogg')
    expect(getMimeTypeFromPath('movie.mp4')).toBe('video/mp4')
    expect(getMimeTypeFromPath('movie.webm')).toBe('video/webm')
    expect(getMimeTypeFromPath('movie.mov')).toBe('video/quicktime')
    expect(getMimeTypeFromPath('pic.avif')).toBe('image/avif')
    expect(getMimeTypeFromPath('logo.svg')).toBe('image/svg+xml')
    // saveImage names files `<id>.<subtype>`
    expect(getMimeTypeFromPath('abc.svg+xml')).toBe('image/svg+xml')
    expect(getMimeTypeFromPath('abc.jpeg')).toBe('image/jpeg')
  })

  it('no extension, a dotfile or an unknown extension has no type', () => {
    expect(getMimeTypeFromPath('JYeiPzuglpwr4cMRmCDFFmROnzXwdrDZAzg8vaZZRpY')).toBeUndefined()
    expect(getMimeTypeFromPath('.env')).toBeUndefined()
    expect(getMimeTypeFromPath('file.')).toBeUndefined()
    expect(getMimeTypeFromPath('file.xyz123')).toBeUndefined()
  })

  it('every extension maps to a type whose download extension maps back to the same type', () => {
    for (const mime of Object.values(EXTENSION_TO_MIME)) {
      const ext = MIME_TO_EXTENSION[mime]
      expect(ext, mime).toBeDefined()
      expect(EXTENSION_TO_MIME[ext!], `${mime} -> ${ext}`).toBe(mime)
    }
    expect(getExtensionForMimeType('audio/mpeg')).toBe('mp3')
    expect(getExtensionForMimeType('image/jpeg')).toBe('jpg')
    expect(getExtensionForMimeType('Text/Markdown; charset=utf-8')).toBe('md')
    expect(getExtensionForMimeType('application/octet-stream')).toBeUndefined()
  })

  it('sniffs common signatures', () => {
    const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)])
    expect(sniffMimeType(bytes(0x89, ...ascii('PNG'), 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png')
    expect(sniffMimeType(bytes(...ascii('%PDF-1.7')))).toBe('application/pdf')
    expect(sniffMimeType(bytes(...ascii('ID3')))).toBe('audio/mpeg')
    expect(sniffMimeType(bytes(...ascii('OggS')))).toBe('audio/ogg')
    expect(sniffMimeType(bytes(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVE')))).toBe('audio/wav')
    expect(sniffMimeType(bytes(0x1a, 0x45, 0xdf, 0xa3))).toBe('video/webm')
    expect(sniffMimeType(bytes(0, 0, 0, 0x20, ...ascii('ftypisom')))).toBe('video/mp4')
    expect(sniffMimeType(bytes(0, 0, 0, 0x20, ...ascii('ftypqt  ')))).toBe('video/quicktime')
    expect(sniffMimeType(bytes(0, 0, 0, 0x20, ...ascii('ftypavif')))).toBe('image/avif')
    expect(sniffMimeType(new TextEncoder().encode('hello'))).toBeUndefined()
  })

  it('upload type: the source type wins, then the extension, then the bytes', () => {
    const pdf = new Uint8Array(ascii('%PDF-1.4 ...'))
    expect(resolveUploadMimeType({ sourceType: 'audio/ogg', fileName: 'a.mp3', bytes: pdf })).toBe('audio/ogg')
    expect(resolveUploadMimeType({ sourceType: 'application/octet-stream', fileName: 'a.mp3', bytes: pdf })).toBe(
      'audio/mpeg',
    )
    expect(resolveUploadMimeType({ sourceType: '', fileName: 'seed-local-id', bytes: pdf })).toBe('application/pdf')
    expect(resolveUploadMimeType({ fileName: 'seed-local-id', bytes: new Uint8Array([1, 2, 3]) })).toBeUndefined()
  })

  it('the download worker carries the same MIME -> extension map and sniffer', () => {
    expect(filesDownload.startsWith(`const SEED_MIME_TO_EXTENSION = ${JSON.stringify(MIME_TO_EXTENSION)};`)).toBe(true)
    expect(filesDownload).toContain(`const seedSniffMimeType = ${sniffMimeType.toString()};`)
  })

  it('sniffs ICO, and a BMP header needs more than its two signature bytes', () => {
    expect(sniffMimeType(new Uint8Array([0x00, 0x00, 0x01, 0x00, 0x01, 0x00]))).toBe('image/x-icon')
    expect(sniffMimeType(new Uint8Array([...ascii('BM'), 0xff]))).toBeUndefined()
  })
})

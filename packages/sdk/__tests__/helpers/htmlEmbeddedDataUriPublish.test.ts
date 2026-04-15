import { describe, it, expect } from 'vitest'
import {
  extractDataUriImagesFromHtml,
  replaceDataUrisInParsedHtml,
  HtmlEmbeddedDataUriLimitError,
} from '@/helpers/htmlEmbeddedDataUriPublish'

/** Minimal valid 1×1 PNG base64 */
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

describe('htmlEmbeddedDataUriPublish', () => {
  it('extractDataUriImagesFromHtml collects img data URIs and dedupes', async () => {
    const uri = `data:image/png;base64,${TINY_PNG_B64}`
    const html = `<p><img src="${uri}"/><img src="${uri}"/></p>`
    const entries = await extractDataUriImagesFromHtml(html)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.dataUri).toBe(uri)
    expect(entries[0]!.mimeType).toBe('image/png')
  })

  it('replaceDataUrisInParsedHtml swaps matched src values', async () => {
    const uri = `data:image/png;base64,${TINY_PNG_B64}`
    const html = `<img src="${uri}" alt="x">`
    const map = new Map<string, string>([[uri, 'https://arweave.net/tx123']])
    const out = replaceDataUrisInParsedHtml(html, map)
    expect(out).toContain('https://arweave.net/tx123')
    expect(out).not.toContain('data:image/png')
  })

  it('rejects disallowed mime types', async () => {
    const html = `<img src="data:image/bmp;base64,AAAA"/>`
    await expect(extractDataUriImagesFromHtml(html)).rejects.toThrow(HtmlEmbeddedDataUriLimitError)
  })
})

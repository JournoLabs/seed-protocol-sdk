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

  describe('replaceDataUrisInParsedHtml keeps every other byte', () => {
    const uri = `data:image/png;base64,${TINY_PNG_B64}`
    const url = 'https://arweave.net/tx123'
    const replace = (html: string) => replaceDataUrisInParsedHtml(html, new Map([[uri, url]]))

    it('keeps the leading newline of pre, textarea and listing', () => {
      for (const tag of ['pre', 'textarea', 'listing']) {
        const html = `<${tag}>\n\ncode</${tag}><img src="${uri}">`
        expect(replace(html)).toBe(`<${tag}>\n\ncode</${tag}><img src="${url}">`)
      }
    })

    it('keeps a full document: doctype, html, head and body', () => {
      const html = `<!DOCTYPE html>\n<html lang="en"><head><title>t</title></head><body><img src="${uri}"></body></html>\n`
      expect(replace(html)).toBe(html.replace(uri, url))
    })

    it('keeps line endings, quoting, case and entities outside the replaced src', () => {
      const html = `<P Class='a'>x &amp; y\r\n<IMG ALT=pic SRC = '${uri}' >é😀<img src="${uri}"/></P>`
      expect(replace(html)).toBe(
        `<P Class='a'>x &amp; y\r\n<IMG ALT=pic src="${url}" >é😀<img src="${url}"/></P>`,
      )
    })

    it('matches a src with surrounding whitespace', () => {
      expect(replace(`<img src=" ${uri} ">`)).toBe(`<img src="${url}">`)
    })

    it('leaves the same string in text, other attributes and other elements', () => {
      const html = `<p title="${uri}">${uri}</p><a href="${uri}">a</a><img alt="${uri}">`
      expect(replace(html)).toBe(html)
    })

    it('escapes a replacement value for a double-quoted attribute', () => {
      const out = replaceDataUrisInParsedHtml(`<img src="${uri}">`, new Map([[uri, 'https://g/?a=1&b="2"']]))
      expect(out).toBe('<img src="https://g/?a=1&amp;b=&quot;2&quot;">')
    })
  })

  it('rejects disallowed mime types', async () => {
    const html = `<img src="data:image/bmp;base64,AAAA"/>`
    await expect(extractDataUriImagesFromHtml(html)).rejects.toThrow(HtmlEmbeddedDataUriLimitError)
  })
})

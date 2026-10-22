import { describe, expect, it } from 'vitest'
import { findHtmlUrls, parseArchiveDocument, rewriteHtmlUrls } from '../src'

// The shape PermaPress seals (decision 0174): the head in <header>, the body in e-content.
const permaPressPost = [
  '<article class="h-entry">\r\n',
  '<header><h1 class="p-name">The Case for  Paper</h1>',
  '<p class="p-summary">Why print lasts</p>',
  '<p>By <a class="p-author h-card" href="https://example.com/jane"><span class="p-name">Jane Doe</span></a>',
  ' · <time class="dt-published" datetime="2026-10-08">Oct 8, 2026</time></p>',
  '<img class="u-featured" src="https://ar.seedprotocol.io/raw/' + 'a'.repeat(43) + '" alt="A press"></header>',
  '<div class="e-content"><p>Body &amp; soul.</p>\n<pre>\n\ncode</pre>',
  '<article class="h-entry"><h2 class="p-name">Quoted</h2><div class="e-content">inner</div></article></div>',
  '</article>',
].join('')

describe('parseArchiveDocument', () => {
  it('reads an h-entry and slices e-content byte for byte', () => {
    const doc = parseArchiveDocument(permaPressPost)
    expect(doc.method).toBe('h-entry')
    expect(doc.name).toBe('The Case for Paper')
    expect(doc.summary).toBe('Why print lasts')
    expect(doc.authors).toEqual(['Jane Doe'])
    expect(doc.published).toBe('2026-10-08')
    expect(doc.featured).toEqual({ url: `https://ar.seedprotocol.io/raw/${'a'.repeat(43)}`, alt: 'A press' })
    // The nested entry stays part of the body, and the <pre> newline the parser eats is kept.
    expect(doc.content).toBe(
      '<p>Body &amp; soul.</p>\n<pre>\n\ncode</pre>' +
        '<article class="h-entry"><h2 class="p-name">Quoted</h2><div class="e-content">inner</div></article>',
    )
  })

  it('reads a full document with the h-entry inside body', () => {
    const doc = parseArchiveDocument(`<!doctype html><html><head><title>t</title></head><body>${permaPressPost}</body></html>`)
    expect(doc.method).toBe('h-entry')
    expect(doc.name).toBe('The Case for Paper')
  })

  it('falls back to itemprop=articleBody, keeping h-entry fields', () => {
    const doc = parseArchiveDocument(
      '<article class="h-entry"><h1 class="p-name">T</h1><div itemprop="articleBody"><p>b</p></div></article>',
    )
    expect(doc).toMatchObject({ method: 'articleBody', content: '<p>b</p>', name: 'T' })
  })

  it('falls back to a lone article without its header and footer', () => {
    const doc = parseArchiveDocument('<article><header><h1>T</h1></header>\n<p>one</p><p>two</p><footer>f</footer></article>')
    expect(doc).toMatchObject({ method: 'article', content: '\n<p>one</p><p>two</p>', authors: [] })
  })

  it('treats anything else as a bare body', () => {
    const html = '<p>a</p><article>1</article><article>2</article>'
    expect(parseArchiveDocument(html)).toEqual({ method: 'fragment', content: html, authors: [] })
  })
})

describe('rewriteHtmlUrls', () => {
  it('changes only whole src/href/poster values it maps, and leaves every other byte', () => {
    const html = "<IMG SRC = 'https://g/raw/x' alt=\"https://g/raw/x\">\r\n<a href=\" https://g/raw/x \">x</a><img srcset=\"https://g/raw/x 2x\">"
    const out = rewriteHtmlUrls(html, (url) => (url === 'https://g/raw/x' ? 'assets/x.png' : undefined))
    expect(out).toBe(
      '<IMG src="assets/x.png" alt="https://g/raw/x">\r\n<a href="assets/x.png">x</a><img srcset="https://g/raw/x 2x">',
    )
    expect(findHtmlUrls(html)).toEqual(['https://g/raw/x'])
  })
})

import { describe, expect, it } from 'vitest'
import { jsonLdScript, type JsonLdDocument } from '../src/index'

const doc: JsonLdDocument = {
  '@context': { schema: 'https://schema.org/' },
  '@graph': [{ '@id': 'urn:example:post', 'schema:headline': 'Tom & Jerry </script><script>alert(1)</script>' }],
}

const inner = (html: string): string => {
  const match = /^<script type="application\/ld\+json">([\s\S]*)<\/script>$/.exec(html)
  expect(match).not.toBeNull()
  return match![1]!
}

describe('jsonLdScript', () => {
  it('wraps the document in a JSON-LD script element that parses back to the same document', () => {
    expect(JSON.parse(inner(jsonLdScript(doc)))).toEqual(doc)
  })

  it('escapes markup so a value cannot close the script element', () => {
    const body = inner(jsonLdScript(doc))
    expect(body).not.toMatch(/[<>&]/)
    expect(body).toContain('\\u003c/script\\u003e')
  })

  it('escapes the line and paragraph separators', () => {
    const withSeparators: JsonLdDocument = { '@context': {}, '@graph': [{ '@id': 'urn:x', note: 'a\u2028b\u2029c' }] }
    const body = inner(jsonLdScript(withSeparators))
    expect(body).toContain('a\\u2028b\\u2029c')
    expect(JSON.parse(body)).toEqual(withSeparators)
  })
})

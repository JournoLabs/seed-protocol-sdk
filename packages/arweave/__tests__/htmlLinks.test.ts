import { describe, expect, it } from 'vitest'
import {
  nextArweaveGatewayUrl,
  parseArweaveTransactionLink,
  publishedArweaveLinksInHtml,
  rehostArweaveLinksInHtml,
} from '../src/htmlLinks.js'

/**
 * ADR 0025: readers re-host Arweave links in Html onto their own gateway list, whatever host the
 * Html was published with.
 */

const TX = 'Ab3_-'.padEnd(43, 'x')
const TX2 = 'Zz9'.padEnd(43, 'y')
const baseUrls = ['https://reader.example', 'https://arweave.net', 'https://permagate.io']

describe('parseArweaveTransactionLink', () => {
  it('reads ar://, /raw/ on any host (with a path prefix) and /<id> on known gateways', () => {
    expect(parseArweaveTransactionLink(`ar://${TX}`, { baseUrls })).toEqual({ transactionId: TX, form: 'raw', rest: '' })
    expect(parseArweaveTransactionLink(`https://ar.seedprotocol.io/raw/${TX}`, { baseUrls })).toEqual({
      transactionId: TX,
      form: 'raw',
      rest: '',
    })
    expect(parseArweaveTransactionLink(`https://app.example/api/seed-gateway/raw/${TX}?v=2#top`, { baseUrls })).toEqual({
      transactionId: TX,
      form: 'raw',
      rest: '?v=2#top',
    })
    expect(parseArweaveTransactionLink(`https://arweave.net/${TX}/index.html`, { baseUrls })).toEqual({
      transactionId: TX,
      form: 'bare',
      rest: '/index.html',
    })
  })

  it('ignores a bare /<id> on a host that is not a gateway, and ids of the wrong length', () => {
    expect(parseArweaveTransactionLink(`https://blog.example/${TX}`, { baseUrls })).toBeUndefined()
    expect(parseArweaveTransactionLink(`https://arweave.net/raw/${TX.slice(1)}`, { baseUrls })).toBeUndefined()
    expect(parseArweaveTransactionLink('ar://my-arns-name', { baseUrls })).toBeUndefined()
    expect(parseArweaveTransactionLink(`seed:property/image`, { baseUrls })).toBeUndefined()
  })
})

describe('rehostArweaveLinksInHtml', () => {
  it('moves every Arweave link onto the first base URL, keeping its path form', () => {
    const html =
      `<p><img src="https://ar.seedprotocol.io/raw/${TX}" alt="a"></p>` +
      `<a href="https://arweave.net/${TX2}">doc</a>` +
      `<video poster="ar://${TX}"></video>`
    expect(rehostArweaveLinksInHtml(html, { baseUrls })).toBe(
      `<p><img src="https://reader.example/raw/${TX}" alt="a"></p>` +
        `<a href="https://reader.example/${TX2}">doc</a>` +
        `<video poster="https://reader.example/raw/${TX}"></video>`,
    )
  })

  it('rewrites each srcset candidate and keeps its descriptor', () => {
    const html = `<img srcset="https://ar.seedprotocol.io/raw/${TX} 1x, https://ar.seedprotocol.io/raw/${TX2} 2x">`
    expect(rehostArweaveLinksInHtml(html, { baseUrls })).toBe(
      `<img srcset="https://reader.example/raw/${TX} 1x, https://reader.example/raw/${TX2} 2x">`,
    )
  })

  it('keeps every other byte, including other links and text that looks like a link', () => {
    const html =
      `<!-- ar://${TX} -->\n<pre>\nhttps://arweave.net/raw/${TX}</pre>` +
      `<a HREF='https://blog.example/${TX}' class=x>keep</a>`
    expect(rehostArweaveLinksInHtml(html, { baseUrls })).toBe(html)
  })

  it('returns the Html unchanged when there is nothing to re-host', () => {
    const html = `<img src="https://reader.example/raw/${TX}">`
    expect(rehostArweaveLinksInHtml(html, { baseUrls })).toBe(html)
    expect(rehostArweaveLinksInHtml('<p>plain</p>', { baseUrls })).toBe('<p>plain</p>')
  })
})

describe('nextArweaveGatewayUrl', () => {
  it('moves a link to the next base URL, then stops after the last', () => {
    const first = `https://reader.example/raw/${TX}`
    const second = nextArweaveGatewayUrl(first, { baseUrls })
    expect(second).toBe(`https://arweave.net/raw/${TX}`)
    const third = nextArweaveGatewayUrl(second!, { baseUrls })
    expect(third).toBe(`https://permagate.io/raw/${TX}`)
    expect(nextArweaveGatewayUrl(third!, { baseUrls })).toBeUndefined()
  })

  it('starts at the first base URL for a link on a host outside the list', () => {
    expect(nextArweaveGatewayUrl(`https://ar.seedprotocol.io/raw/${TX}`, { baseUrls })).toBe(
      `https://reader.example/raw/${TX}`,
    )
  })
})

describe('publishedArweaveLinksInHtml', () => {
  const html =
    `<img src="http://127.0.0.1:1984/raw/${TX}">` +
    `<a href="https://ar.seedprotocol.io/${TX2}">doc</a>` +
    `<img src="ar://${TX2}">`
  const local = ['http://127.0.0.1:1984', 'https://arweave.net']

  it('puts every link a reader re-hosted back on the public gateway before upload', () => {
    expect(publishedArweaveLinksInHtml(html, { publicBaseUrl: 'https://arweave.net', baseUrls: local })).toBe(
      `<img src="https://arweave.net/raw/${TX}">` +
        `<a href="https://arweave.net/${TX2}">doc</a>` +
        `<img src="https://arweave.net/raw/${TX2}">`,
    )
  })

  it('writes ar:// links when asked', () => {
    expect(publishedArweaveLinksInHtml(html, { to: 'ar', publicBaseUrl: 'https://arweave.net', baseUrls: local })).toBe(
      `<img src="ar://${TX}">` + `<a href="ar://${TX2}">doc</a>` + `<img src="ar://${TX2}">`,
    )
  })
})

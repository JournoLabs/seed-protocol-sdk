import { catalogUrlTable } from './catalog/cc/urls'
import { isKnownSpdxId } from './spdx/parse'

const CC_LICENSE = /^\/licenses\/(by|by-sa|by-nc|by-nc-sa|by-nd|by-nc-nd)\/(\d+\.\d+)(?:\/([a-z]{2}))?(?:\/(?:deed\.[a-z-]+|legalcode(?:\.[a-z-]+)?))?$/
const CC_ZERO = /^\/publicdomain\/zero\/1\.0(?:\/(?:deed\.[a-z-]+|legalcode(?:\.[a-z-]+)?))?$/
const SPDX_PAGE = /^\/licenses\/([A-Za-z0-9.+-]+?)(?:\.html|\.json)?$/

/** host without `www.`, then the path without a trailing slash, lowercased unless asked. */
function normalize(url: URL, keepCase = false): { host: string; path: string } {
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  const path = url.pathname.replace(/\/+$/, '')
  return { host, path: keepCase ? path : path.toLowerCase() }
}

let table: Map<string, string> | undefined
function catalogUrls(): Map<string, string> {
  if (!table) {
    table = new Map()
    for (const [url, spdx] of catalogUrlTable()) {
      const { host, path } = normalize(new URL(url))
      table.set(host + path, spdx)
    }
  }
  return table
}

/**
 * The SPDX id a license URL names, or null. Reads Creative Commons license, deed and legal-code
 * URLs of any version and jurisdiction port, CC0, spdx.org license pages, and the catalog's own
 * URLs. An id is returned only when the SPDX list has it. Never throws.
 */
export function fromUrl(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  const { host, path } = normalize(parsed)

  if (host === 'creativecommons.org') {
    const license = CC_LICENSE.exec(path)
    if (license) {
      const [, code, version, port] = license
      return isKnownSpdxId(`CC-${code}-${version}${port ? `-${port}` : ''}`) ?? null
    }
    if (CC_ZERO.test(path)) return 'CC0-1.0'
  }
  if (host === 'spdx.org') {
    const page = SPDX_PAGE.exec(normalize(parsed, true).path)
    if (page) return isKnownSpdxId(page[1]!) ?? null
  }
  return catalogUrls().get(host + path) ?? null
}

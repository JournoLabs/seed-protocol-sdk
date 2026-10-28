import { parseFragment } from 'parse5'
import type { DefaultTreeAdapterTypes } from 'parse5'
import { KNOWN_ARWEAVE_GATEWAYS, isKnownArweaveGatewayHostname } from './constants.js'
import { getArweaveReadBaseUrls } from './gateway/readBaseUrls.js'

/**
 * A link to an Arweave transaction, split so it can be rebuilt on another gateway (ADR 0025).
 * `raw` is `/raw/<id>` (the data as stored, no manifest resolution); `bare` is `/<id>` (manifests
 * resolve; `arweave.net` redirects to a sandbox subdomain). `ar://<id>` parses as `raw`.
 */
export type ArweaveTransactionLink = {
  transactionId: string
  form: 'raw' | 'bare'
  /** Path, query and hash after the id, e.g. `/index.html` or `?v=2`. */
  rest: string
}

const TX_ID = '[A-Za-z0-9_-]{43}'
const AR_URL = new RegExp(`^ar://(${TX_ID})([/?#].*)?$`)
const RAW_PATH = new RegExp(`/raw/(${TX_ID})(/.*)?$`)
const BARE_PATH = new RegExp(`^/(${TX_ID})(/.*)?$`)

export type ArweaveLinkOptions = {
  /** Base URLs to re-host onto, in order. Defaults to {@link getArweaveReadBaseUrls}. */
  baseUrls?: readonly string[]
}

const hostOf = (url: string): string | undefined => {
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return undefined
  }
}

/** A base URL's origin and path prefix (no trailing slash; `''` at the root). */
function splitBase(baseUrl: string): { origin: string; path: string } | undefined {
  try {
    const url = new URL(baseUrl)
    return { origin: url.origin, path: url.pathname.replace(/\/+$/, '') }
  } catch {
    return undefined
  }
}

/**
 * The base URL in `baseUrls` that `url` is on, and the path after the base's path. When several
 * match (`https://host` and `https://host/proxy`), the one with the longest path wins.
 */
function findBase(url: URL, baseUrls: readonly string[]): { index: number; path: string } | undefined {
  let found: { index: number; path: string; prefixLength: number } | undefined
  baseUrls.forEach((baseUrl, index) => {
    const base = splitBase(baseUrl)
    if (!base || base.origin !== url.origin) return
    if (base.path && !url.pathname.startsWith(`${base.path}/`)) return
    if (found && found.prefixLength >= base.path.length) return
    found = { index, path: url.pathname.slice(base.path.length), prefixLength: base.path.length }
  })
  return found && { index: found.index, path: found.path }
}

/**
 * Hosts whose root `/<id>` paths are Arweave transactions: known gateways, the defaults, and read
 * base URLs at a host's root. A base with a path prefix (an app proxy) only claims paths under it.
 */
function isGatewayHost(host: string, baseUrls: readonly string[]): boolean {
  const h = host.toLowerCase()
  if (isKnownArweaveGatewayHostname(h.replace(/:\d+$/, ''))) return true
  const rootBases = baseUrls.filter((baseUrl) => splitBase(baseUrl)?.path === '')
  for (const gateway of [...rootBases.map(hostOf), ...KNOWN_ARWEAVE_GATEWAYS]) {
    if (gateway && (h === gateway || h.endsWith(`.${gateway}`))) return true
  }
  return false
}

/**
 * Parse `ar://<id>`, `<any host>/raw/<id>` (any path prefix, so an app proxy's URL counts too), a
 * gateway's `/<id>`, or `{base}/<id>` on a base URL in `baseUrls`, path prefix included. A bare
 * `/<id>` anywhere else is not a link: the path shape is too common elsewhere.
 */
export function parseArweaveTransactionLink(
  url: string,
  options?: ArweaveLinkOptions,
): ArweaveTransactionLink | undefined {
  const raw = url.trim()
  const ar = AR_URL.exec(raw)
  if (ar) return { transactionId: ar[1]!, form: 'raw', rest: ar[2] ?? '' }
  if (!/^https?:\/\//i.test(raw)) return undefined
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return undefined
  }
  const suffix = parsed.search + parsed.hash
  const rawPath = RAW_PATH.exec(parsed.pathname)
  if (rawPath) return { transactionId: rawPath[1]!, form: 'raw', rest: (rawPath[2] ?? '') + suffix }
  const baseUrls = options?.baseUrls ?? getArweaveReadBaseUrls()
  const base = findBase(parsed, baseUrls)
  const barePath =
    (base && BARE_PATH.exec(base.path)) ||
    (isGatewayHost(parsed.host, baseUrls) ? BARE_PATH.exec(parsed.pathname) : null)
  if (barePath) {
    return { transactionId: barePath[1]!, form: 'bare', rest: (barePath[2] ?? '') + suffix }
  }
  return undefined
}

/** `link` on `baseUrl` (scheme, host and any path prefix). */
export function buildArweaveTransactionLink(link: ArweaveTransactionLink, baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '')
  return `${base}${link.form === 'raw' ? '/raw/' : '/'}${link.transactionId}${link.rest}`
}

/**
 * The same transaction on the next base URL after the one `url` is on, for retrying a load that
 * failed. Undefined when `url` isn't an Arweave link or every base URL has been tried.
 */
export function nextArweaveGatewayUrl(url: string, options?: ArweaveLinkOptions): string | undefined {
  const baseUrls = options?.baseUrls ?? getArweaveReadBaseUrls()
  const link = parseArweaveTransactionLink(url, { baseUrls })
  if (!link) return undefined
  let current = -1
  try {
    current = findBase(new URL(url.trim()), baseUrls)?.index ?? -1
  } catch {
    // ar://<id> and other non-http links are on no base URL
  }
  const next = baseUrls[current + 1]
  return next ? buildArweaveTransactionLink(link, next) : undefined
}

function escapeAttributeValue(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

/**
 * Rewrite attribute values of `html` by splicing each new value into the original string: every
 * byte other than the rewritten attributes stays as written. Re-serializing the parsed tree would
 * not round-trip (parse5 drops the newline the parser eats after `<pre>`/`<textarea>`/`<listing>`,
 * a fragment parse drops doctype/html/head/body, and quoting, case and line endings are normalized),
 * and sealed Html must not change with the serializer.
 *
 * `rewrite` gets each attribute's (entity-decoded) value and returns its new value, or undefined to
 * leave it. A rewritten attribute is written as `name="value"`.
 */
export function rewriteHtmlAttributes(
  html: string,
  rewrite: (element: DefaultTreeAdapterTypes.Element, attrName: string, value: string) => string | undefined,
): string {
  const fragment = parseFragment(html, { sourceCodeLocationInfo: true })
  const edits: { start: number; end: number; text: string }[] = []
  const walk = (node: DefaultTreeAdapterTypes.ChildNode): void => {
    if (node.nodeName === '#text' || node.nodeName === '#comment') return
    const el = node as DefaultTreeAdapterTypes.Element
    if (el.attrs?.length) {
      for (const attr of el.attrs) {
        if (attr.prefix) continue
        const next = rewrite(el, attr.name, attr.value)
        const location = el.sourceCodeLocation?.attrs?.[attr.name]
        if (next === undefined || !location) continue
        edits.push({
          start: location.startOffset,
          end: location.endOffset,
          text: `${attr.name}="${escapeAttributeValue(next)}"`,
        })
      }
    }
    const parent = el as DefaultTreeAdapterTypes.ParentNode
    if (parent.childNodes) {
      for (const c of parent.childNodes) walk(c)
    }
    // <template> content is a separate fragment
    const content = (el as DefaultTreeAdapterTypes.Template).content
    if (content?.childNodes) {
      for (const c of content.childNodes) walk(c)
    }
  }
  for (const c of fragment.childNodes) walk(c as DefaultTreeAdapterTypes.ChildNode)

  let out = html
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end)
  }
  return out
}

/** Attributes holding one URL. */
const URL_ATTRIBUTES = new Set(['src', 'href', 'poster'])

/** Each `srcset` candidate's URL passed through `map`, descriptors kept. */
function mapSrcset(value: string, map: (url: string) => string | undefined): string | undefined {
  let changed = false
  const out = value.split(',').map((candidate) => {
    const match = /^(\s*)(\S+)(.*)$/s.exec(candidate)
    if (!match) return candidate
    const next = map(match[2]!)
    if (next === undefined) return candidate
    changed = true
    return `${match[1]}${next}${match[3]}`
  })
  return changed ? out.join(',') : undefined
}

/** Calls `map` on each URL in a `src`, `href`, `poster` or `srcset` value; undefined when none changes. */
export function mapUrlAttribute(
  attrName: string,
  value: string,
  map: (url: string) => string | undefined,
): string | undefined {
  if (attrName === 'srcset') return mapSrcset(value, map)
  if (!URL_ATTRIBUTES.has(attrName)) return undefined
  const next = map(value.trim())
  return next === undefined || next === value ? undefined : next
}

/** Cheap check before parsing: could `html` hold a link {@link parseArweaveTransactionLink} accepts? */
function mayHoldArweaveLinks(html: string, baseUrls: readonly string[]): boolean {
  if (html.includes('ar://') || html.includes('/raw/')) return true
  const lower = html.toLowerCase()
  if (lower.includes('arweave.net') || lower.includes('ar-io.net')) return true
  for (const host of [...baseUrls.map(hostOf), ...KNOWN_ARWEAVE_GATEWAYS]) {
    if (host && lower.includes(host)) return true
  }
  return false
}

/**
 * Re-host the Arweave links in `html` (`src`, `href`, `poster`, `srcset`) onto the first base URL
 * of the reader's gateway list, keeping each link's path form (ADR 0025). Other markup is kept byte
 * for byte. The result is for showing to this reader only: the first base URL can be a local
 * sidecar or proxy, so it must not be stored or uploaded.
 */
export function rehostArweaveLinksInHtml(html: string, options?: ArweaveLinkOptions): string {
  const baseUrls = options?.baseUrls ?? getArweaveReadBaseUrls()
  const target = baseUrls[0]
  if (!target || !html || !mayHoldArweaveLinks(html, baseUrls)) return html
  const rehost = (url: string): string | undefined => {
    const link = parseArweaveTransactionLink(url, { baseUrls })
    if (!link) return undefined
    const next = buildArweaveTransactionLink(link, target)
    return next === url ? undefined : next
  }
  return rewriteHtmlAttributes(html, (_el, attrName, value) => mapUrlAttribute(attrName, value, rehost))
}

/** How publish writes Arweave links into Html (ADR 0025). */
export type HtmlArweaveRefs = 'gateway' | 'ar'

/**
 * The Arweave links in `html` as publish uploads them: on `publicBaseUrl` (form kept), or as
 * `ar://<id>` with `to: 'ar'`. Links re-hosted for a reader (a sidecar, a proxy, another gateway)
 * become public again before upload. Other bytes are kept.
 */
export function publishedArweaveLinksInHtml(
  html: string,
  { to = 'gateway', publicBaseUrl, baseUrls }: { to?: HtmlArweaveRefs; publicBaseUrl: string } & ArweaveLinkOptions,
): string {
  const known = [publicBaseUrl, ...(baseUrls ?? getArweaveReadBaseUrls())]
  if (!html || !mayHoldArweaveLinks(html, known)) return html
  const publish = (url: string): string | undefined => {
    const link = parseArweaveTransactionLink(url, { baseUrls: known })
    if (!link) return undefined
    const next = to === 'ar' ? `ar://${link.transactionId}${link.rest}` : buildArweaveTransactionLink(link, publicBaseUrl)
    return next === url ? undefined : next
  }
  return rewriteHtmlAttributes(html, (_el, attrName, value) => mapUrlAttribute(attrName, value, publish))
}

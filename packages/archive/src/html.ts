import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5'

export type HtmlElement = DefaultTreeAdapterTypes.Element
export type HtmlNode = DefaultTreeAdapterTypes.ChildNode

/** `html` parsed as a fragment with source offsets, so callers can slice or splice the original string. */
export const parseHtmlWithLocations = (html: string): DefaultTreeAdapterTypes.DocumentFragment =>
  parseFragment(html, { sourceCodeLocationInfo: true })

export const isElement = (node: HtmlNode): node is HtmlElement =>
  node.nodeName !== '#text' && node.nodeName !== '#comment' && node.nodeName !== '#documentType'

export const childElements = (node: { childNodes?: HtmlNode[] }): HtmlElement[] =>
  (node.childNodes ?? []).filter(isElement)

/** An element's children, including a `<template>`'s content. */
const childrenOf = (node: HtmlElement): HtmlNode[] =>
  node.tagName === 'template'
    ? ((node as DefaultTreeAdapterTypes.Template).content?.childNodes ?? [])
    : (node.childNodes ?? [])

/** Calls `visit` for each element under `nodes`, depth first; returning false skips that element's children. */
export function walkElements(nodes: HtmlNode[], visit: (element: HtmlElement) => boolean | void): void {
  for (const node of nodes) {
    if (!isElement(node)) continue
    if (visit(node) === false) continue
    walkElements(childrenOf(node), visit)
  }
}

export const attribute = (element: HtmlElement, name: string): string | undefined =>
  element.attrs.find((a) => a.name === name && !a.prefix)?.value

export const classTokens = (element: HtmlElement): string[] =>
  (attribute(element, 'class') ?? '').split(/\s+/).filter(Boolean)

const NON_TEXT_ELEMENTS = new Set(['script', 'style', 'template'])

/** Concatenated text of `node`, leaving out script, style and template content. */
export function textContent(node: HtmlNode): string {
  if (node.nodeName === '#text') return (node as DefaultTreeAdapterTypes.TextNode).value
  if (!isElement(node) || NON_TEXT_ELEMENTS.has(node.tagName)) return ''
  return (node.childNodes ?? []).map(textContent).join('')
}

/** The exact source of an element's children: from the end of its start tag to the start of its end tag. */
export function innerSource(html: string, element: HtmlElement): string {
  const location = element.sourceCodeLocation
  if (!location?.startTag) return ''
  const end = location.endTag?.startOffset ?? location.endOffset
  return html.slice(location.startTag.endOffset, end)
}

/** The exact source of one node. */
export const nodeSource = (html: string, node: HtmlNode): string => {
  const location = node.sourceCodeLocation
  return location ? html.slice(location.startOffset, location.endOffset) : ''
}

const escapeAttributeValue = (value: string): string => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')

/**
 * Rewrites attribute values by splicing each new value into the original string, so every byte
 * outside the rewritten attributes stays as written. Re-serializing the parsed tree would not
 * round-trip (parse5 drops the newline after `<pre>`, a fragment parse drops doctype, html, head
 * and body, and quoting, case and line endings are normalized), and sealed Html must not change.
 *
 * `rewrite` gets each attribute's entity-decoded value and returns the new value, or undefined to
 * leave it. A rewritten attribute is written as `name="value"`.
 */
export function rewriteHtmlAttributes(
  html: string,
  rewrite: (element: HtmlElement, attrName: string, value: string) => string | undefined,
): string {
  const fragment = parseHtmlWithLocations(html)
  const edits: { start: number; end: number; text: string }[] = []
  walkElements(fragment.childNodes, (element) => {
    for (const attr of element.attrs) {
      if (attr.prefix) continue
      const next = rewrite(element, attr.name, attr.value)
      const location = element.sourceCodeLocation?.attrs?.[attr.name]
      if (next === undefined || !location) continue
      edits.push({ start: location.startOffset, end: location.endOffset, text: `${attr.name}="${escapeAttributeValue(next)}"` })
    }
  })

  let out = html
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end)
  }
  return out
}

/** Attributes whose whole value is one URL. `srcset` lists several and is not rewritten. */
export const URL_ATTRIBUTES = new Set(['src', 'href', 'poster'])

/**
 * Replaces whole `src`, `href` and `poster` values that `replace` maps to a new URL (e.g. a
 * gateway URL to a bag-relative path). Values are compared trimmed. Other bytes are kept.
 */
export const rewriteHtmlUrls = (html: string, replace: (url: string) => string | undefined): string =>
  rewriteHtmlAttributes(html, (_element, attrName, value) =>
    URL_ATTRIBUTES.has(attrName) ? replace(value.trim()) : undefined,
  )

/** Every whole `src`, `href` and `poster` value in `html`, trimmed, each once, in document order. */
export function findHtmlUrls(html: string): string[] {
  const urls = new Set<string>()
  walkElements(parseHtmlWithLocations(html).childNodes, (element) => {
    for (const attr of element.attrs) {
      if (!attr.prefix && URL_ATTRIBUTES.has(attr.name) && attr.value.trim()) urls.add(attr.value.trim())
    }
  })
  return [...urls]
}

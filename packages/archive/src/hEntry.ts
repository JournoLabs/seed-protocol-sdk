import {
  attribute,
  childElements,
  classTokens,
  innerSource,
  nodeSource,
  parseHtmlWithLocations,
  textContent,
  walkElements,
  type HtmlElement,
} from './html'

/**
 * Reads an archive document: Html that marks up an article as a microformats2 h-entry
 * (https://microformats.org/wiki/h-entry), the way PermaPress seals a Post. Documents without
 * an h-entry are read by fallbacks, so archives from other clients still yield a body.
 *
 * Only the properties archives use are read: p-name, p-summary, p-author, dt-published,
 * u-featured, u-url and e-content. This is not a full microformats2 parser: implied
 * properties and value-class patterns are not applied.
 */

/** How the body was found, most to least reliable. `fragment` means the whole input is the body. */
export type ArchiveDocumentMethod = 'h-entry' | 'articleBody' | 'article' | 'fragment'

export type ArchiveDocument = {
  method: ArchiveDocumentMethod
  /** The body's exact source, sliced from the input (not re-serialized). */
  content: string
  name?: string
  summary?: string
  /** dt-published as written: a `datetime`/`value` attribute, else the element's text. */
  published?: string
  /** Each p-author: a nested h-card's p-name, else the element's text. */
  authors: string[]
  featured?: { url: string; alt?: string }
  url?: string
}

const isMicroformatRoot = (element: HtmlElement): boolean => classTokens(element).some((c) => c.startsWith('h-'))

const cleanText = (element: HtmlElement): string => textContent(element).replace(/\s+/g, ' ').trim()

const firstWithClass = (roots: HtmlElement[], token: string): HtmlElement | undefined => {
  let found: HtmlElement | undefined
  walkElements(roots, (element) => {
    if (found) return false
    if (classTokens(element).includes(token)) {
      found = element
      return false
    }
  })
  return found
}

const DATETIME_ELEMENTS = new Set(['time', 'ins', 'del'])

function readHEntry(html: string, root: HtmlElement): ArchiveDocument {
  const doc: ArchiveDocument = { method: 'h-entry', content: '', authors: [] }
  let contentFound = false

  walkElements(childElements(root), (element) => {
    const classes = classTokens(element)
    const nested = isMicroformatRoot(element)

    if (classes.includes('p-author')) {
      const name = nested ? firstWithClass(childElements(element), 'p-name') : undefined
      const author = name ? cleanText(name) : cleanText(element)
      if (author) doc.authors.push(author)
    }
    // A nested microformat's own properties belong to it, not to this entry.
    if (nested) return false

    if (classes.includes('p-name') && doc.name === undefined) doc.name = cleanText(element)
    if (classes.includes('p-summary') && doc.summary === undefined) doc.summary = cleanText(element)
    if (classes.includes('dt-published') && doc.published === undefined) {
      doc.published =
        (DATETIME_ELEMENTS.has(element.tagName) ? attribute(element, 'datetime') : undefined) ??
        attribute(element, 'value') ??
        cleanText(element)
    }
    if (classes.includes('u-featured') && doc.featured === undefined) {
      const url = attribute(element, 'src') ?? attribute(element, 'href') ?? cleanText(element)
      if (url) doc.featured = { url: url.trim(), alt: attribute(element, 'alt') }
    }
    if (classes.includes('u-url') && doc.url === undefined) {
      const url = attribute(element, 'href') ?? attribute(element, 'src') ?? cleanText(element)
      if (url) doc.url = url.trim()
    }
    if (classes.includes('e-content') && !contentFound) {
      contentFound = true
      doc.content = innerSource(html, element)
      // The body's own markup can't add properties to the entry.
      return false
    }
  })
  return doc
}

/**
 * The body and descriptive fields of `html`. The body is taken, in order, from:
 *
 * 1. `.h-entry .e-content` (with the entry's other properties)
 * 2. the first `[itemprop=articleBody]`
 * 3. the only top-level `<article>`, without its direct `<header>` and `<footer>` children
 * 4. the whole input
 *
 * An h-entry without e-content falls through to the later steps for its body, keeping its
 * other properties.
 */
export function parseArchiveDocument(html: string): ArchiveDocument {
  const fragment = parseHtmlWithLocations(html)
  const top = fragment.childNodes

  let entry: ArchiveDocument | undefined
  let entryRoot: HtmlElement | undefined
  walkElements(top, (element) => {
    if (entryRoot) return false
    if (classTokens(element).includes('h-entry')) {
      entryRoot = element
      return false
    }
  })
  if (entryRoot) {
    entry = readHEntry(html, entryRoot)
    if (entry.content || firstWithClass(childElements(entryRoot), 'e-content')) return entry
  }
  const base: Omit<ArchiveDocument, 'method' | 'content'> = entry
    ? { name: entry.name, summary: entry.summary, published: entry.published, authors: entry.authors, featured: entry.featured, url: entry.url }
    : { authors: [] }

  let articleBody: HtmlElement | undefined
  walkElements(top, (element) => {
    if (articleBody) return false
    if (attribute(element, 'itemprop')?.split(/\s+/).includes('articleBody')) {
      articleBody = element
      return false
    }
  })
  if (articleBody) return { ...base, method: 'articleBody', content: innerSource(html, articleBody) }

  // Top-level here means outside any other article; html/head/body wrappers of a full document don't count.
  const articles: HtmlElement[] = []
  walkElements(top, (element) => {
    if (element.tagName === 'article') {
      articles.push(element)
      return false
    }
  })
  if (articles.length === 1) {
    const article = articles[0] as HtmlElement
    const content = (article.childNodes ?? [])
      .filter((node) => !('tagName' in node) || (node.tagName !== 'header' && node.tagName !== 'footer'))
      .map((node) => nodeSource(html, node))
      .join('')
    return { ...base, method: 'article', content }
  }

  return { ...base, method: 'fragment', content: html }
}

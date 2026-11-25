/**
 * Plain-text renderings of a publication for LLMs and agents: one item as Markdown with its
 * provenance in front matter, and an `llms.txt` index (https://llmstxt.org).
 */

import TurndownService from 'turndown'
import { getPublicArweaveBaseUrl } from '@seedprotocol/arweave'
import type { SeedRecord } from '@seedprotocol/query'
import { withPublicArweaveLinks } from './getFeedItems'
import { pickFeedItemContent, pickFeedItemDescription } from './pickFeedItemRichText'

/** The licence an item is offered under, as the caller knows it. */
export interface ItemLicense {
  /** SPDX id or licence name, e.g. `CC-BY-4.0`. */
  name: string
  /** The licence's legal text or deed. */
  url?: string
  /** One plain-language sentence, e.g. from `summarySentence` in @seedprotocol/licensing. */
  summary?: string
}

export interface ItemMarkdownOptions {
  /** Where the item is published, written to front matter as `url`. */
  url?: string
  license?: ItemLicense
}

/** The part of a DOM element the rules read; this package compiles without the DOM lib. */
type Element = { nodeName: string; getAttribute(name: string): string | null }

let turndown: TurndownService | undefined

function converter(): TurndownService {
  if (turndown) return turndown
  const service = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
  })
  service.remove(['script', 'style', 'noscript', 'iframe'])
  // Turndown has no Markdown table output; an LLM reads an HTML table as well as a pipe table.
  service.keep(['table'])
  service.addRule('embeddedImage', {
    filter: (node) => {
      const el = node as unknown as Element
      return el.nodeName === 'IMG' && (el.getAttribute('src') ?? '').startsWith('data:')
    },
    replacement: (_content, node) => {
      const alt = (node as unknown as Element).getAttribute('alt')?.trim()
      return alt ? `[image: ${alt}]` : '[image]'
    },
  })
  turndown = service
  return service
}

/**
 * Markdown for an HTML fragment. Scripts, styles and iframes are dropped, tables stay HTML, and an
 * image embedded as a `data:` URI becomes `[image: alt]` so the Markdown doesn't carry its bytes.
 */
export function htmlToMarkdown(html: string): string {
  return converter().turndown(html)
}

function stringField(data: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = data[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return undefined
}

function itemTitle(record: SeedRecord): string {
  return stringField(record.data, ['title', 'Title']) ?? record.seedUid
}

function authorNames(data: Record<string, unknown>): string[] {
  const found = data.authors ?? data.Authors ?? data.author ?? data.Author
  if (found === undefined || found === null) return []
  const authors: unknown[] = Array.isArray(found) ? found : [found]
  return authors.flatMap((author) => {
    if (typeof author === 'string') return author.trim() ? [author.trim()] : []
    if (author && typeof author === 'object') {
      const name = stringField(author as Record<string, unknown>, ['name', 'displayName'])
      return name ? [name] : []
    }
    return []
  })
}

/** A YAML double-quoted scalar. JSON string syntax is valid YAML. */
const yamlString = (value: string): string => JSON.stringify(value)

/**
 * One item as Markdown: YAML front matter with its title, seed UID, version UID, attester, schema,
 * creation time, authors, summary, `url` and licence when given, then the title as a heading and
 * the body. The body is the record's rich body field (see `pickFeedItemContent`) converted with
 * {@link htmlToMarkdown}, or its plain text as it is. Arweave links are put on the public gateway,
 * as in feeds.
 *
 * Pass a record read with `hydrateStorage` (the default) so the body is the text rather than an
 * Arweave URL. Licence terms aren't read from EAS; pass the item's licence in `options.license`.
 */
export function itemMarkdown(record: SeedRecord, options: ItemMarkdownOptions = {}): string {
  const data = withPublicArweaveLinks(record.data, getPublicArweaveBaseUrl()) as Record<string, unknown>
  const title = itemTitle(record)

  const lines = ['---', `title: ${yamlString(title)}`, `seed_uid: ${yamlString(record.seedUid)}`]
  if (record.versionUid) lines.push(`version_uid: ${yamlString(record.versionUid)}`)
  if (record.attester) lines.push(`attester: ${yamlString(record.attester)}`)
  lines.push(`schema: ${yamlString(record.schemaName)}`)
  if (record.timeCreated > 0) {
    lines.push(`published: ${yamlString(new Date(record.timeCreated * 1000).toISOString())}`)
  }
  const authors = authorNames(data)
  if (authors.length > 0) lines.push('authors:', ...authors.map((name) => `  - ${yamlString(name)}`))
  const summary = pickFeedItemDescription(data).trim()
  if (summary) lines.push(`summary: ${yamlString(summary)}`)
  if (options.url) lines.push(`url: ${yamlString(options.url)}`)
  if (options.license) {
    lines.push(`license: ${yamlString(options.license.name)}`)
    if (options.license.url) lines.push(`license_url: ${yamlString(options.license.url)}`)
    if (options.license.summary) lines.push(`license_summary: ${yamlString(options.license.summary)}`)
  }
  lines.push('---', '', `# ${oneLine(title)}`, '')

  const content = pickFeedItemContent(data).trim()
  const body = content.includes('<') ? htmlToMarkdown(content) : content
  if (body) lines.push(body, '')
  return lines.join('\n')
}

export interface LlmsTxtLink {
  title: string
  url: string
  /** Text after the link, kept to one line. */
  note?: string
}

export interface LlmsTxtSection {
  name: string
  links: readonly LlmsTxtLink[]
  /**
   * Links an agent can skip when it has little room. Optional sections' links go under one
   * `## Optional` heading at the end, as llms.txt specifies.
   */
  optional?: boolean
}

export interface LlmsTxtInput {
  title: string
  /** One-line summary, written as the blockquote under the title. */
  description?: string
  /** Paragraphs between the summary and the sections. */
  details?: string
  sections: readonly LlmsTxtSection[]
}

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()
/** Spaces and parentheses end or break a Markdown link destination, so they're percent-encoded. */
const linkUrl = (url: string): string => url.replace(/[ ()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)
const linkText = (text: string): string => oneLine(text).replace(/[[\]]/g, (c) => `\\${c}`)

function linkLines(links: readonly LlmsTxtLink[]): string[] {
  return links.map((link) => {
    const note = link.note ? oneLine(link.note) : ''
    return `- [${linkText(link.title)}](${linkUrl(link.url)})${note ? `: ${note}` : ''}`
  })
}

/**
 * An `llms.txt` file: the title as `#`, the description as a blockquote, the details, then one `##`
 * section of links per section. Sections with no links are left out.
 */
export function llmsTxt(input: LlmsTxtInput): string {
  const blocks = [`# ${oneLine(input.title)}`]
  if (input.description) blocks.push(`> ${oneLine(input.description)}`)
  if (input.details?.trim()) blocks.push(input.details.trim())
  const optional: LlmsTxtLink[] = []
  for (const section of input.sections) {
    if (section.optional) {
      optional.push(...section.links)
      continue
    }
    if (section.links.length > 0) blocks.push(`## ${oneLine(section.name)}`, linkLines(section.links).join('\n'))
  }
  if (optional.length > 0) blocks.push('## Optional', linkLines(optional).join('\n'))
  return `${blocks.join('\n\n')}\n`
}

/**
 * A link per record for an `llms.txt` section: the record's title (its seed UID when it has none),
 * the URL `urlFor` gives, usually the item's Markdown, and its summary as the note.
 */
export function llmsTxtItemLinks(
  records: readonly SeedRecord[],
  urlFor: (record: SeedRecord) => string,
): LlmsTxtLink[] {
  return records.map((record) => {
    const note = pickFeedItemDescription(record.data).trim()
    return { title: itemTitle(record), url: urlFor(record), ...(note ? { note } : {}) }
  })
}

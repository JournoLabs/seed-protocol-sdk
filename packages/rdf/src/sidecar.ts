import { easName, fuzzyNameKey } from '@seedprotocol/eas'
import { XSD, iriScheme } from './iri.js'
import { RELATION_TYPES, expandTerm, prefixesOf, type RdfLens, type RdfSidecar } from './lens.js'

export type SidecarContextOptions = {
  /** Base of the protocol class for a model whose properties are mapped but which isn't. Default PROVISIONAL_BASE_IRI. */
  base?: string
}

type ContextEntry = string | { readonly [key: string]: string | ContextEntry }
export type SidecarContext = { readonly [key: string]: unknown }

/**
 * The sidecar's `@context` regenerated from its `terms` and the schema's current names: its
 * keywords and prefixes as they are, then one type-scoped entry per model that has a term or a
 * mapped property. A relation gets `"@type": "@id"`, a List `"@container": "@list"`, a Date
 * `xsd:dateTime`. A model without a term keeps its protocol class. Terms that can't be expanded are
 * left out.
 */
export function sidecarContext({ schema, sidecar }: RdfLens, options: SidecarContextOptions = {}): SidecarContext {
  const prefixes = prefixesOf(sidecar)
  const usable = (id: string | undefined): string | undefined => {
    const term = id ? sidecar.terms[id] : undefined
    return term !== undefined && expandTerm(term, prefixes) ? term : undefined
  }
  const context: Record<string, unknown> = { '@version': 1.1 }
  for (const [key, value] of Object.entries(sidecar['@context'] ?? {})) {
    if (key.startsWith('@') || typeof value === 'string') context[key] = value
  }

  for (const [modelName, model] of Object.entries(schema.models)) {
    const scoped: Record<string, ContextEntry> = {}
    for (const [key, property] of Object.entries(model.properties)) {
      const term = usable(property.id)
      if (!term) continue
      const dataType = (property.type ?? property.dataType ?? '').toLowerCase()
      const ref = property.ref ?? property.refModelName
      const entry: Record<string, string> = { '@id': term }
      if (RELATION_TYPES.has(dataType) || (dataType === 'list' && ref)) entry['@type'] = '@id'
      if (dataType === 'date') entry['@type'] = `${XSD}dateTime`
      if (dataType === 'list') entry['@container'] = '@list'
      scoped[key] = Object.keys(entry).length === 1 ? term : entry
    }
    const term = usable(model.id)
    if (!term && Object.keys(scoped).length === 0) continue
    if (modelName in context) continue
    context[modelName] = {
      '@id': term ?? iriScheme(1, options.base).modelClass(easName(modelName)),
      ...(Object.keys(scoped).length > 0 && { '@context': scoped }),
    }
  }
  return context
}

/** A model, or a property of one, that `terms` can name. */
export type SchemaTarget = { readonly model: string; readonly property?: string; readonly id?: string }

export type SidecarReport = {
  /** Terms whose id is no model or property in the schema, as after a deletion. */
  readonly stale: readonly { readonly id: string; readonly term: string }[]
  /** Terms that aren't an IRI or a name with a prefix in `@context`. */
  readonly invalid: readonly { readonly id: string; readonly term: string }[]
  /** Models and properties with no term. One without an `id` can't be mapped until the schema assigns it one. */
  readonly unmapped: readonly SchemaTarget[]
  /** `@context` differs from {@link sidecarContext}, as after a rename: `syncSidecar` rewrites it. */
  readonly contextOutdated: boolean
  /** `schemaVersion` differs from the schema's `version`. */
  readonly versionOutdated: boolean
}

/** A schema as the sidecar tools read it: the lens's, plus its version. */
export type SidecarSchema = RdfLens['schema'] & { readonly version?: number }

function targets(schema: SidecarSchema): SchemaTarget[] {
  return Object.entries(schema.models).flatMap(([model, { id, properties }]) => [
    { model, id },
    ...Object.entries(properties).map(([property, { id }]) => ({ model, property, id })),
  ])
}

// JSON with object keys sorted, so key order doesn't count as a difference.
const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v,
  )

function assertSameSchema({ schema, sidecar }: RdfLens): void {
  if (!schema.id || schema.id !== sidecar.schemaId) {
    throw new TypeError(`The sidecar is for schema ${sidecar.schemaId}, not ${schema.id ?? 'a schema with no id'}`)
  }
}

/** What's out of date in a sidecar against its schema. Throws when it was written for another schema. */
export function checkSidecar(
  lens: { readonly schema: SidecarSchema; readonly sidecar: RdfSidecar },
  options: SidecarContextOptions = {},
): SidecarReport {
  assertSameSchema(lens)
  const { schema, sidecar } = lens
  const all = targets(schema)
  const ids = new Set(all.flatMap((t) => (t.id ? [t.id] : [])))
  const prefixes = prefixesOf(sidecar)
  const terms = Object.entries(sidecar.terms).map(([id, term]) => ({ id, term }))
  return {
    stale: terms.filter(({ id }) => !ids.has(id)),
    invalid: terms.filter(({ id, term }) => ids.has(id) && !expandTerm(term, prefixes)),
    unmapped: all.filter((t) => !t.id || sidecar.terms[t.id] === undefined),
    contextOutdated: stable(sidecar['@context'] ?? {}) !== stable(sidecarContext(lens, options)),
    versionOutdated: schema.version !== undefined && sidecar.schemaVersion !== schema.version,
  }
}

/**
 * The sidecar with `@context` regenerated by {@link sidecarContext} and `schemaVersion` set to the
 * schema's `version`. `terms` is kept as it is, stale ones too: removing a mapping is the
 * developer's call.
 */
export function syncSidecar(
  lens: { readonly schema: SidecarSchema; readonly sidecar: RdfSidecar },
  options: SidecarContextOptions = {},
): RdfSidecar {
  assertSameSchema(lens)
  const { schema, sidecar } = lens
  const { schemaId, schemaVersion, terms, '@context': _context, ...rest } = sidecar
  return {
    schemaId,
    ...(schema.version !== undefined ? { schemaVersion: schema.version } : schemaVersion !== undefined && { schemaVersion }),
    ...rest,
    terms,
    '@context': sidecarContext(lens, options),
  }
}

export const SUGGESTED_PREFIXES = { schema: 'https://schema.org/', dcterms: 'http://purl.org/dc/terms/' } as const

// Kept to names whose meaning rarely varies; anything else is left to the developer.
type Terms = { readonly [name: string]: string }
// The tables by the fuzzy key a name is looked up by.
const keyed = (terms: Terms, relation = false): Terms =>
  Object.fromEntries(Object.entries(terms).map(([name, term]) => [fuzzyNameKey(name, { relation }), term]))

const MODEL_TERMS = keyed({
  post: 'schema:BlogPosting',
  blogpost: 'schema:BlogPosting',
  article: 'schema:Article',
  newsarticle: 'schema:NewsArticle',
  page: 'schema:WebPage',
  person: 'schema:Person',
  organization: 'schema:Organization',
  event: 'schema:Event',
  place: 'schema:Place',
  image: 'schema:ImageObject',
  video: 'schema:VideoObject',
  podcast: 'schema:PodcastSeries',
  episode: 'schema:Episode',
  book: 'schema:Book',
  comment: 'schema:Comment',
})
const TEXT_TERMS = keyed({
  title: 'dcterms:title',
  headline: 'schema:headline',
  name: 'schema:name',
  summary: 'dcterms:abstract',
  abstract: 'dcterms:abstract',
  excerpt: 'dcterms:abstract',
  description: 'dcterms:description',
  subtitle: 'schema:alternativeHeadline',
  language: 'dcterms:language',
  lang: 'dcterms:language',
  license: 'dcterms:license',
  url: 'schema:url',
  link: 'schema:url',
  canonicalurl: 'schema:url',
  email: 'schema:email',
  keyword: 'schema:keywords',
  body: 'schema:text',
  content: 'schema:text',
  text: 'schema:text',
})
const DATE_TERMS = keyed({
  publishedat: 'dcterms:issued',
  datepublished: 'dcterms:issued',
  publishdate: 'dcterms:issued',
  issued: 'dcterms:issued',
  createdat: 'dcterms:created',
  created: 'dcterms:created',
  updatedat: 'dcterms:modified',
  modifiedat: 'dcterms:modified',
  modified: 'dcterms:modified',
  startdate: 'schema:startDate',
  enddate: 'schema:endDate',
})
const RELATION_TERMS = keyed(
  {
  author: 'dcterms:creator',
  creator: 'dcterms:creator',
  byline: 'dcterms:creator',
  contributor: 'dcterms:contributor',
  publisher: 'dcterms:publisher',
  editor: 'schema:editor',
  image: 'schema:image',
  coverimage: 'schema:image',
  featuredimage: 'schema:image',
  cover: 'schema:image',
  thumbnail: 'schema:thumbnail',
  html: 'schema:text',
  body: 'schema:text',
  content: 'schema:text',
  tag: 'dcterms:subject',
  category: 'dcterms:subject',
  categories: 'dcterms:subject',
  topic: 'dcterms:subject',
  source: 'dcterms:source',
  file: 'schema:associatedMedia',
  },
  true,
)

export type TermSuggestion = SchemaTarget & { readonly id: string; readonly term: string }

/**
 * Draft schema.org and dcterms terms for the unmapped models and properties whose names have a
 * common meaning (`title`, `summary`, `author`, `publishedAt`, `coverImage`), for the developer to
 * review. Names it doesn't know, and models or properties without an id, get no suggestion. The
 * terms use the prefixes in {@link SUGGESTED_PREFIXES}.
 */
export function suggestTerms(lens: { readonly schema: SidecarSchema; readonly sidecar: RdfSidecar }): TermSuggestion[] {
  assertSameSchema(lens)
  const { schema, sidecar } = lens
  const suggestions: TermSuggestion[] = []
  for (const [model, { id, properties }] of Object.entries(schema.models)) {
    const modelTerm = MODEL_TERMS[fuzzyNameKey(model)]
    if (id && sidecar.terms[id] === undefined && modelTerm) suggestions.push({ model, id, term: modelTerm })
    for (const [property, definition] of Object.entries(properties)) {
      if (!definition.id || sidecar.terms[definition.id] !== undefined) continue
      const dataType = (definition.type ?? definition.dataType ?? '').toLowerCase()
      const relation = RELATION_TYPES.has(dataType) || (dataType === 'list' && !!(definition.ref ?? definition.refModelName))
      const key = fuzzyNameKey(property, { relation })
      const term = relation ? RELATION_TERMS[key] : dataType === 'date' ? DATE_TERMS[key] : dataType === 'text' ? TEXT_TERMS[key] : undefined
      if (term) suggestions.push({ model, property, id: definition.id, term })
    }
  }
  return suggestions
}

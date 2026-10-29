import type { RdfObject, StateGraph } from './graph.js'
import { RDF_TYPE, XSD } from './iri.js'
import { compacter, prefixesFor } from './names.js'

type JsonLdValue = string | boolean | { '@id': string } | { '@value': string; '@type': string } | { '@list': JsonLdValue[] }

export type JsonLdDocument = {
  '@context': Record<string, string>
  '@graph': Array<Record<string, unknown>>
}

/**
 * JSON-LD 1.1 with an inline context: one node object per subject in `@graph`. A string literal is
 * a JSON string, a boolean a JSON boolean, every other literal a typed value object (so large
 * integers keep their digits), and a list `@list`. Expands to the same graph as `toQuads`.
 */
export function toJsonLd(graph: StateGraph): JsonLdDocument {
  const prefixes = prefixesFor(graph)
  prefixes.delete('rdf')
  const { compact: toPrefixed, used } = compacter(prefixes)
  const compact = (iri: string): string => {
    const short = toPrefixed(iri)
    return short ? `${short[0]}:${short[1]}` : iri
  }

  const value = (o: RdfObject): JsonLdValue => {
    if (o.kind === 'iri') return { '@id': o.iri }
    if (o.kind === 'list') return { '@list': o.items.map(value) }
    if (o.datatype === `${XSD}string`) return o.value
    if (o.datatype === `${XSD}boolean`) return o.value === 'true'
    return { '@value': o.value, '@type': compact(o.datatype) }
  }

  const nodes = graph.nodes.map((node) => {
    const out: Record<string, unknown> = { '@id': node.id }
    for (const [predicate, objects] of node.properties) {
      if (predicate === RDF_TYPE) {
        out['@type'] = objects.map((o) => (o.kind === 'iri' ? compact(o.iri) : '')).filter(Boolean)
        continue
      }
      const values = objects.map(value)
      out[compact(predicate)] = values.length === 1 ? values[0] : values
    }
    return out
  })

  const context: Record<string, string> = {}
  for (const [prefix, ns] of prefixes) if (used.has(prefix)) context[prefix] = ns
  return { '@context': context, '@graph': nodes }
}

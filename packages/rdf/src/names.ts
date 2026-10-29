import type { StateGraph } from './graph.js'
import { PROV, RDF, XSD } from './iri.js'

// A local part that needs no escaping in Turtle and stays a compact IRI in JSON-LD.
const SAFE_LOCAL = /^[A-Za-z_][A-Za-z0-9_-]*$/
const SAFE_PREFIX = /^[a-z][a-z0-9]*$/

/** Namespace by prefix for the graph: the fixed ones, then `c:` and one `p_<type>:` per EAS type. */
export function prefixesFor(graph: StateGraph): Map<string, string> {
  const { base } = graph.iris
  const prefixes = new Map<string, string>([
    ['rdf', RDF],
    ['xsd', XSD],
    ['prov', PROV],
    ['schema', 'https://schema.org/'],
    ['seed', graph.iris.seed],
    ['c', `${base}c/`],
  ])
  for (const node of graph.nodes) {
    for (const predicate of node.properties.keys()) {
      if (!predicate.startsWith(`${base}p/`)) continue
      const easType = predicate.slice(base.length + 2).split('/')[0]!
      if (SAFE_PREFIX.test(easType)) prefixes.set(`p_${easType}`, `${base}p/${easType}/`)
    }
  }
  return prefixes
}

/**
 * A function giving `[prefix, local]` for an IRI under the longest namespace whose local part is
 * safe, or undefined, and the prefixes it has used.
 */
export function compacter(prefixes: ReadonlyMap<string, string>) {
  const used = new Set<string>()
  const compact = (iri: string): [string, string] | undefined => {
    let best: [string, string] | undefined
    for (const [prefix, ns] of prefixes) {
      if (!iri.startsWith(ns) || (best && prefixes.get(best[0])!.length >= ns.length)) continue
      const local = iri.slice(ns.length)
      if (SAFE_LOCAL.test(local)) best = [prefix, local]
    }
    if (best) used.add(best[0])
    return best
  }
  return { compact, used }
}

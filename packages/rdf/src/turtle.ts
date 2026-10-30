import type { RdfObject, StateGraph } from './graph.js'
import { RDF, RDF_TYPE, XSD } from './iri.js'
import { compacter, prefixesFor } from './names.js'
import { escapeLiteral } from './quads.js'

/**
 * Turtle (RDF 1.1): prefixes, then one block per subject. Names are prefixed where the local
 * part needs no escaping and written as full IRIs otherwise; lists use collection syntax.
 */
export function toTurtle(graph: StateGraph): string {
  const prefixes = prefixesFor(graph)
  const { compact, used } = compacter(prefixes)
  const name = (iri: string): string => {
    const short = compact(iri)
    return short ? `${short[0]}:${short[1]}` : `<${iri}>`
  }

  const object = (o: RdfObject): string => {
    if (o.kind === 'iri') return name(o.iri)
    if (o.kind === 'list') return o.items.length === 0 ? name(`${RDF}nil`) : `( ${o.items.map(object).join(' ')} )`
    const quoted = `"${escapeLiteral(o.value)}"`
    return o.datatype === `${XSD}string` ? quoted : `${quoted}^^${name(o.datatype)}`
  }

  const blocks = graph.nodes.map((node) => {
    const lines = [...node.properties].map(([predicate, objects]) => {
      const verb = predicate === RDF_TYPE ? 'a' : name(predicate)
      return `    ${verb} ${objects.map(object).join(', ')}`
    })
    return `${name(node.id)}\n${lines.join(' ;\n')} .\n`
  })

  const header = [...prefixes]
    .filter(([prefix]) => used.has(prefix))
    .map(([prefix, ns]) => `@prefix ${prefix}: <${ns}> .\n`)
    .join('')
  return `${header}${header ? '\n' : ''}${blocks.join('\n')}`
}

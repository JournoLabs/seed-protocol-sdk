import type * as RDF from '@rdfjs/types'
import type { RdfObject, StateGraph } from './graph.js'
import { RDF_FIRST, RDF_NIL, RDF_REST, XSD } from './iri.js'

const XSD_STRING = `${XSD}string`

class NamedNode implements RDF.NamedNode {
  readonly termType = 'NamedNode'
  constructor(readonly value: string) {}
  equals(other: RDF.Term | null | undefined): boolean {
    return !!other && other.termType === this.termType && other.value === this.value
  }
}

class BlankNode implements RDF.BlankNode {
  readonly termType = 'BlankNode'
  constructor(readonly value: string) {}
  equals(other: RDF.Term | null | undefined): boolean {
    return !!other && other.termType === this.termType && other.value === this.value
  }
}

class Literal implements RDF.Literal {
  readonly termType = 'Literal'
  readonly language = ''
  readonly direction = ''
  readonly datatype: RDF.NamedNode
  constructor(
    readonly value: string,
    datatype: string,
  ) {
    this.datatype = new NamedNode(datatype)
  }
  equals(other: RDF.Term | null | undefined): boolean {
    return (
      !!other &&
      other.termType === this.termType &&
      other.value === this.value &&
      other.language === '' &&
      other.datatype.equals(this.datatype)
    )
  }
}

class DefaultGraph implements RDF.DefaultGraph {
  readonly termType = 'DefaultGraph'
  readonly value = ''
  equals(other: RDF.Term | null | undefined): boolean {
    return !!other && other.termType === this.termType
  }
}

const DEFAULT_GRAPH = new DefaultGraph()

class Quad implements RDF.BaseQuad {
  readonly termType = 'Quad'
  readonly value = ''
  readonly graph = DEFAULT_GRAPH
  constructor(
    readonly subject: RDF.NamedNode | RDF.BlankNode,
    readonly predicate: RDF.NamedNode,
    readonly object: RDF.NamedNode | RDF.BlankNode | RDF.Literal,
  ) {}
  equals(other: RDF.Term | null | undefined): boolean {
    if (!other || other.termType !== 'Quad') return false
    return (
      this.subject.equals(other.subject) &&
      this.predicate.equals(other.predicate) &&
      this.object.equals(other.object) &&
      this.graph.equals(other.graph)
    )
  }
}

/**
 * The graph as RDF/JS quads (`@rdfjs/types`), all in the default graph, for N3.js, Comunica,
 * Oxigraph or rdf-ext. List cells are blank nodes labelled `l0`, `l1`, … in the order written.
 */
export function toQuads(graph: StateGraph): RDF.Quad[] {
  const quads: RDF.Quad[] = []
  let cells = 0

  const term = (object: RdfObject): RDF.NamedNode | RDF.BlankNode | RDF.Literal => {
    if (object.kind === 'iri') return new NamedNode(object.iri)
    if (object.kind === 'literal') return new Literal(object.value, object.datatype)
    if (object.items.length === 0) return new NamedNode(RDF_NIL)
    const heads = object.items.map(() => new BlankNode(`l${cells++}`))
    object.items.forEach((item, i) => {
      quads.push(new Quad(heads[i]!, new NamedNode(RDF_FIRST), term(item)))
      quads.push(new Quad(heads[i]!, new NamedNode(RDF_REST), heads[i + 1] ?? new NamedNode(RDF_NIL)))
    })
    return heads[0]!
  }

  for (const node of graph.nodes) {
    const subject = new NamedNode(node.id)
    for (const [predicate, objects] of node.properties) {
      for (const object of objects) {
        quads.push(new Quad(subject, new NamedNode(predicate), term(object)))
      }
    }
  }
  return quads
}

/** A string's characters escaped for a double-quoted N-Triples or Turtle literal. */
export const escapeLiteral = (value: string): string =>
  value.replace(/[\\"\n\r]/g, (c) => (c === '\\' ? '\\\\' : c === '"' ? '\\"' : c === '\n' ? '\\n' : '\\r'))

function writeTerm(term: RDF.Term): string {
  if (term.termType === 'NamedNode') return `<${term.value}>`
  if (term.termType === 'BlankNode') return `_:${term.value}`
  if (term.termType === 'Literal') {
    const quoted = `"${escapeLiteral(term.value)}"`
    return term.datatype.value === XSD_STRING ? quoted : `${quoted}^^<${term.datatype.value}>`
  }
  throw new TypeError(`Can't write a ${term.termType} term`)
}

/** N-Quads (RDF 1.1), one statement per line, in the order of `toQuads`. */
export function toNQuads(graph: StateGraph): string {
  return toQuads(graph)
    .map((q) => `${writeTerm(q.subject)} ${writeTerm(q.predicate)} ${writeTerm(q.object)} .\n`)
    .join('')
}

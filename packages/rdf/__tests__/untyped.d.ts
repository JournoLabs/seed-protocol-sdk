// n3 2.x and rdf-canonize ship no type declarations; these cover what the tests use.
declare module 'n3' {
  import type * as RDF from '@rdfjs/types'
  export class Parser {
    constructor(options?: { format?: string })
    parse(input: string): RDF.Quad[]
  }
  export class Store implements RDF.DatasetCore {
    constructor(quads?: RDF.Quad[])
    readonly size: number
    add(quad: RDF.Quad): this
    delete(quad: RDF.Quad): this
    has(quad: RDF.Quad): boolean
    match(subject?: RDF.Term | null, predicate?: RDF.Term | null, object?: RDF.Term | null, graph?: RDF.Term | null): RDF.DatasetCore
    [Symbol.iterator](): Iterator<RDF.Quad>
    getObjects(subject: RDF.Term | string | null, predicate: RDF.Term | string | null, graph: RDF.Term | string | null): RDF.Quad_Object[]
    getSubjects(predicate: RDF.Term | string | null, object: RDF.Term | string | null, graph: RDF.Term | string | null): RDF.Quad_Subject[]
    getQuads(
      subject: RDF.Term | string | null,
      predicate: RDF.Term | string | null,
      object: RDF.Term | string | null,
      graph: RDF.Term | string | null,
    ): RDF.Quad[]
  }
}

declare module 'rdf-canonize' {
  export function canonize(
    input: string,
    options: { algorithm: 'RDFC-1.0'; inputFormat: 'application/n-quads' },
  ): Promise<string>
}

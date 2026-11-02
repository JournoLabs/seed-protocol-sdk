import { easName } from '@seedprotocol/eas'
import { listRelationEasName } from '@seedprotocol/query'
import { RDF, XSD, iriScheme } from './iri.js'
import { RELATION_TYPES, expandTerm, prefixesOf, type RdfLens } from './lens.js'
import { escapeLiteral } from './quads.js'

const SH = 'http://www.w3.org/ns/shacl#'

// What the state graph writes for each local data type when a lens gives it.
const DATATYPES: { readonly [dataType: string]: readonly string[] } = {
  text: ['string'],
  number: ['integer', 'decimal', 'double'],
  boolean: ['boolean'],
  date: ['dateTime'],
}
const EAS_TYPES: { readonly [dataType: string]: string } = {
  text: 'string',
  number: 'string',
  boolean: 'bool',
  date: 'uint256',
  list: 'bytes32[]',
}

export type ShaclOptions = {
  /** Base of the protocol IRIs, as given to the export. Default PROVISIONAL_BASE_IRI. */
  base?: string
}

/**
 * SHACL 2017 shapes in Turtle for state graphs exported with `lens`: one `sh:NodeShape` per model,
 * targeting the class the export gives its seeds (the mapped term, else `{base}c/{model}`), with a
 * property shape per property on the predicate the export uses. Text, Number, Boolean and Date
 * values get `sh:datatype` (a Number any of `xsd:integer`, `xsd:decimal` or `xsd:double`), and every
 * property `sh:maxCount 1`. Relations, Image, File, Html and Json values must be IRIs; their class
 * isn't checked, because the related seed is often not in the export. A List is checked as a
 * well-formed `rdf:List`, and a List of relations' members must be IRIs. `required: true` adds
 * `sh:minCount 1`. Pass a sidecar with no `terms` for shapes over the protocol IRIs.
 */
export function toShacl(lens: RdfLens, options: ShaclOptions = {}): string {
  const { schema, sidecar } = lens
  if (!schema.id || schema.id !== sidecar.schemaId) {
    throw new TypeError(`The sidecar is for schema ${sidecar.schemaId}, not ${schema.id ?? 'a schema with no id'}`)
  }
  // c/ and p/ IRIs don't name a chain.
  const iris = iriScheme(1, options.base)
  const prefixes = prefixesOf(sidecar)
  const termOf = (id: string | undefined): string | undefined => {
    const term = id ? sidecar.terms[id] : undefined
    return term === undefined ? undefined : expandTerm(term, prefixes)
  }
  const literal = (value: string) => `"${escapeLiteral(value)}"`

  const shapes = Object.entries(schema.models).map(([modelName, model]) => {
    const properties = Object.entries(model.properties).flatMap(([key, property]) => {
      const dataType = (property.type ?? property.dataType ?? '').toLowerCase()
      const ref = property.ref ?? property.refModelName
      const relation = RELATION_TYPES.has(dataType)
      const easType = relation ? 'bytes32' : EAS_TYPES[dataType]
      if (!easType) return []
      const name = dataType === 'list' && ref ? listRelationEasName(key, ref) : easName(key)
      const path = `<${termOf(property.id) ?? iris.property(easType, name)}>`
      const lines = [`sh:path ${path}`, `sh:name ${literal(key)}`, 'sh:maxCount 1']
      if (property.required === true) lines.push('sh:minCount 1')
      const datatypes = DATATYPES[dataType]
      if (datatypes?.length === 1) lines.push(`sh:datatype xsd:${datatypes[0]}`)
      else if (datatypes) lines.push(`sh:or ( ${datatypes.map((d) => `[ sh:datatype xsd:${d} ]`).join(' ')} )`)
      else if (relation) lines.push('sh:nodeKind sh:IRI')
      const shapes = [lines]
      if (dataType === 'list') shapes.push([`sh:path ( ${path} [ sh:zeroOrMorePath rdf:rest ] )`, 'sh:node _:listCell'])
      if (dataType === 'list' && ref) {
        shapes.push([`sh:path ( ${path} [ sh:zeroOrMorePath rdf:rest ] rdf:first )`, 'sh:nodeKind sh:IRI'])
      }
      return shapes.map((shape) => `    sh:property [\n        ${shape.join(' ;\n        ')}\n    ]`)
    })
    const targetClass = termOf(model.id) ?? iris.modelClass(easName(modelName))
    const head = [`[] a sh:NodeShape`, `    sh:name ${literal(modelName)}`, `    sh:targetClass <${targetClass}>`]
    return `${[...head, ...properties].join(' ;\n')} .\n`
  })

  // Each cell of a list: rdf:nil, or one rdf:first and one rdf:rest. Applied to every cell along
  // the path rather than by recursion, which SHACL 2017 leaves undefined.
  const listCell = `_:listCell a sh:NodeShape ;
    sh:or (
        [ sh:hasValue rdf:nil ]
        [
            sh:nodeKind sh:BlankNodeOrIRI ;
            sh:property [ sh:path rdf:first ; sh:minCount 1 ; sh:maxCount 1 ] ;
            sh:property [ sh:path rdf:rest ; sh:minCount 1 ; sh:maxCount 1 ]
        ]
    ) .
`
  const header = [
    ['sh', SH],
    ['rdf', RDF],
    ['xsd', XSD],
  ]
    .map(([prefix, ns]) => `@prefix ${prefix}: <${ns}> .\n`)
    .join('')
  return `${header}\n${listCell}\n${shapes.join('\n')}`
}

import { easName, isNameMatchLevel, matchEasName, type NameMatchLevel } from '@seedprotocol/eas'
import { listRelationEasName } from '@seedprotocol/query'
import { assertIri } from './iri.js'

type LensProperty = {
  readonly id?: string
  readonly type?: string
  readonly dataType?: string
  readonly ref?: string
  readonly refModelName?: string
  readonly nameMatch?: string
  readonly [key: string]: unknown
}

type LensModel = {
  readonly id?: string
  readonly nameMatch?: string
  readonly properties: { readonly [propertyName: string]: LensProperty }
}

/** As much of a schema file as the lens reads. A `SchemaFileFormat` can be passed as it is. */
export type LensSchema = {
  readonly id?: string
  readonly nameMatch?: string
  readonly models: { readonly [modelName: string]: LensModel }
}

/**
 * What an app says its models and properties mean. `terms` is keyed by model or property id, which
 * survive renames, so no older schema file is needed. Each term is a prefixed name or an absolute
 * IRI; prefixes come from the top level of `@context`.
 */
export type RdfSidecar = {
  /** The schema these terms were written for. Must equal the schema's `id`. */
  readonly schemaId: string
  readonly '@context'?: { readonly [prefix: string]: unknown }
  readonly terms: { readonly [id: string]: string }
}

export type RdfLens = {
  readonly schema: LensSchema
  readonly sidecar: RdfSidecar
}

type PropertyEntry = { readonly term?: string; readonly dataType: string }
type ModelEntry = {
  readonly term?: string
  readonly candidates: readonly { value: PropertyEntry; name: string; relation: boolean; level?: NameMatchLevel }[]
}

/** How a lens reads one export's seeds and properties. */
export type CompiledLens = {
  readonly prefixes: ReadonlyMap<string, string>
  readonly warnings: string[]
  /** The class term of a seed's on-chain model, if the lens maps it. */
  classOf(modelType: string): string | undefined
  /** The local data type and term of an on-chain property of a model. */
  propertyOf(modelType: string, easPropertyName: string): PropertyEntry | undefined
}

export const RELATION_TYPES = new Set(['relation', 'image', 'file', 'html', 'json', 'blob'])

const level = (...values: (string | undefined)[]): NameMatchLevel | undefined =>
  values.find((value): value is NameMatchLevel => isNameMatchLevel(value))

export function prefixesOf(sidecar: RdfSidecar): Map<string, string> {
  const prefixes = new Map<string, string>()
  for (const [prefix, value] of Object.entries(sidecar['@context'] ?? {})) {
    if (!prefix.startsWith('@') && typeof value === 'string') prefixes.set(prefix, value)
  }
  return prefixes
}

/** The absolute IRI of a term, or undefined when it can't be read. */
export function expandTerm(term: string, prefixes: ReadonlyMap<string, string>): string | undefined {
  const colon = term.indexOf(':')
  const prefix = colon > 0 ? prefixes.get(term.slice(0, colon)) : undefined
  const expanded = prefix !== undefined ? prefix + term.slice(colon + 1) : term
  if (prefix === undefined && !/^(?:[a-zA-Z][a-zA-Z0-9+.-]*:\/\/|urn:)/.test(term)) return undefined
  try {
    return assertIri(expanded, 'term')
  } catch {
    return undefined
  }
}

/**
 * Reads a lens for one export. A sidecar written for another schema throws; a term that matches no
 * model or property, or can't be expanded, is a warning, and the export uses the protocol IRI.
 */
export function compileLens({ schema, sidecar }: RdfLens): CompiledLens {
  if (!schema.id || schema.id !== sidecar.schemaId) {
    throw new TypeError(`The sidecar is for schema ${sidecar.schemaId}, not ${schema.id ?? 'a schema with no id'}`)
  }
  const prefixes = prefixesOf(sidecar)
  const warnings: string[] = []
  const unused = new Set(Object.keys(sidecar.terms))
  const termOf = (id: string | undefined): string | undefined => {
    if (!id || sidecar.terms[id] === undefined) return undefined
    unused.delete(id)
    const expanded = expandTerm(sidecar.terms[id]!, prefixes)
    if (!expanded) warnings.push(`Term "${sidecar.terms[id]}" for ${id} isn't an IRI or a name with a known prefix`)
    return expanded
  }

  const models = Object.entries(schema.models).map(([modelName, model]) => {
    const candidates = Object.entries(model.properties).map(([key, property]) => {
      const dataType = (property.type ?? property.dataType ?? '').toLowerCase()
      const ref = property.ref ?? property.refModelName
      return {
        value: { term: termOf(property.id), dataType },
        name: dataType === 'list' && ref ? listRelationEasName(key, ref) : easName(key),
        relation: RELATION_TYPES.has(dataType) || (dataType === 'list' && !!ref),
        level: level(property.nameMatch, model.nameMatch, schema.nameMatch),
      }
    })
    const entry: ModelEntry = { term: termOf(model.id), candidates }
    return { value: entry, name: easName(modelName), level: level(model.nameMatch, schema.nameMatch) }
  })
  for (const id of unused) warnings.push(`Term "${sidecar.terms[id]}" names ${id}, which is no model or property in the schema`)

  const warnOnce = (message: string) => {
    if (!warnings.includes(message)) warnings.push(message)
  }
  const modelOf = (modelType: string): ModelEntry | undefined => {
    const match = matchEasName(modelType, models)
    if (match.kind === 'ambiguous') warnOnce(`Model "${modelType}" matches several models in the schema`)
    return match.kind === 'match' ? match.value : undefined
  }

  return {
    prefixes,
    warnings,
    classOf: (modelType) => modelOf(modelType)?.term,
    propertyOf(modelType, easPropertyName) {
      const model = modelOf(modelType)
      if (!model) return undefined
      const match = matchEasName(easPropertyName, model.candidates)
      if (match.kind === 'ambiguous') warnOnce(`Property "${easPropertyName}" of ${modelType} matches several properties in the schema`)
      return match.kind === 'match' ? match.value : undefined
    },
  }
}

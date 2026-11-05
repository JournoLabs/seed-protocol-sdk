import { getSeedAttestations, type GetSeedAttestationsOptions } from '@seedprotocol/query'
import { stateGraph, type StateGraph, type StateGraphOptions } from './graph.js'

export { PROVISIONAL_BASE_IRI, iriScheme } from './iri.js'
export type { IriScheme } from './iri.js'
export { stateGraph } from './graph.js'
export type { RdfNode, RdfObject, StateGraph, StateGraphOptions } from './graph.js'
export type { LensSchema, RdfLens, RdfSidecar } from './lens.js'
export { toQuads, toNQuads } from './quads.js'
export { toTurtle } from './turtle.js'
export { toJsonLd } from './jsonld.js'
export type { JsonLdDocument } from './jsonld.js'
export { seedVocabulary } from './vocabulary.js'
export { DEFAULT_SCHEMA_FILE } from './defaults.js'
export { toShacl } from './shacl.js'
export type { ShaclOptions } from './shacl.js'
export { SUGGESTED_PREFIXES, checkSidecar, sidecarContext, suggestTerms, syncSidecar } from './sidecar.js'
export type {
  SchemaTarget,
  SidecarContext,
  SidecarContextOptions,
  SidecarReport,
  SidecarSchema,
  TermSuggestion,
} from './sidecar.js'

export type ExportSeedsOptions = StateGraphOptions & Pick<GetSeedAttestationsOptions, 'source' | 'pins' | 'asOf'>

/**
 * The state graph of the seeds, read with `getSeedAttestations` from @seedprotocol/query (same
 * sources and pins as `getSeeds`). Seeds that aren't found are left out. With `asOf` (unix
 * seconds), the graph is what EAS held then, the same attestations a reproducible archive bag with
 * that `Seed-Bag-As-Of` holds; it reads EAS and refuses `source: 'local'`. Two exports with the
 * same seeds, `asOf`, options and sidecar give the same bytes from every writer.
 */
export async function exportSeeds(
  seedUids: readonly string[],
  options: ExportSeedsOptions,
): Promise<StateGraph> {
  const { source, pins, asOf, ...graphOptions } = options
  const found = await getSeedAttestations(seedUids, { source, pins, asOf })
  return stateGraph([...found.values()], graphOptions)
}

import { getSeedAttestations, type GetSeedsOptions } from '@seedprotocol/query'
import { stateGraph, type StateGraph, type StateGraphOptions } from './graph.js'

export { PROVISIONAL_BASE_IRI, iriScheme } from './iri.js'
export type { IriScheme } from './iri.js'
export { stateGraph } from './graph.js'
export type { RdfNode, RdfObject, StateGraph, StateGraphOptions } from './graph.js'
export { toQuads, toNQuads } from './quads.js'
export { toTurtle } from './turtle.js'
export { toJsonLd } from './jsonld.js'
export type { JsonLdDocument } from './jsonld.js'
export { seedVocabulary } from './vocabulary.js'

export type ExportSeedsOptions = StateGraphOptions & Pick<GetSeedsOptions, 'source' | 'pins'>

/**
 * The state graph of the seeds, read with `getSeedAttestations` from @seedprotocol/query (same
 * sources and pins as `getSeeds`). Seeds that aren't found are left out.
 */
export async function exportSeeds(
  seedUids: readonly string[],
  options: ExportSeedsOptions,
): Promise<StateGraph> {
  const { source, pins, ...graphOptions } = options
  const found = await getSeedAttestations(seedUids, { source, pins })
  return stateGraph([...found.values()], graphOptions)
}

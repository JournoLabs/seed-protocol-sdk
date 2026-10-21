// Sync reads EAS through this module so tests can replace these with one `vi.mock('@/eas')`.
export {
  getItemVersionsFromEas,
  getItemPropertiesFromEas,
  getSeedsFromSchemaUids,
} from '@seedprotocol/eas'

import { fetchEasModelSchemas } from '@seedprotocol/eas'
import type { EASSchema, ModelSchemaLookup } from '@seedprotocol/eas'
import { localModelSchemaLookups } from '@/db/read/localModelSchemaLookups'

/**
 * The EAS model schemas the local models (or `lookups`) can match; see fetchEasModelSchemas.
 * Init and sync match the result with matchEasModelSchemas and record `model_uids` from it with
 * writeModelUids. Throws when the request fails.
 */
export const getModelSchemasFromEas = async (lookups?: readonly ModelSchemaLookup[]): Promise<EASSchema[]> =>
  fetchEasModelSchemas(lookups ?? (await localModelSchemaLookups())) as Promise<EASSchema[]>

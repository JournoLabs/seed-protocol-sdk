export {
  getItemVersionsFromEas,
  getItemPropertiesFromEas,
  getCanonicalItemPropertiesFromEas,
  getSeedsFromSchemaUids,
  getSeedsBySchemaName,
  getSeedUidsBySchemaName,
  getPublishedByFromEas,
  decodePublishedByData,
  hashPublishedByBatch,
  verifyPublishedByBatch,
  PUBLISHED_BY_SCHEMA_DEF,
  PUBLISHED_BY_SCHEMA_NAME,
} from '@seedprotocol/eas'
export type {
  Attestation,
  EASSchema,
  PublishedByDecoded,
  GetPublishedByFromEasParams,
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

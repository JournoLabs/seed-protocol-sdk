import debug from 'debug'
import { eventEmitter } from '@/eventBus'
import { AmbiguousModelError } from '@/Model/errors'

const logger = debug('seedSdk:db:read:resolveModelForSyncedSeed')

/** Emitted when background work skips a seed whose model name exists in several schemas. */
export const MODEL_AMBIGUOUS_EVENT = 'model:ambiguous' as const

export type ModelAmbiguousEventPayload = {
  modelName: string
  schemaNames: string[]
  seedLocalId?: string
  seedUid?: string
  /** What was being done when the seed was skipped (e.g. 'easSync.metadata'). */
  context: string
}

export type SyncedSeedInfo = {
  seedUid?: string | null
  seedLocalId?: string | null
  /** seeds.type as synced from EAS (the EAS schema name, i.e. snake_case model name). */
  modelType?: string | null
  /** EAS schema UID of the seed attestation. */
  schemaUid?: string | null
}

/**
 * Seam for matching an EAS-synced seed to a local model (its schemaFileId).
 *
 * EAS identifies a seed's model only by name (`bytes32 <model_name>`), so when several local schemas
 * define a model with that name the seed alone can't say which one it is. The plan is to match by
 * the seed's properties and metadata (see docs/EAS_SYNCED_SEED_MODEL_RESOLUTION.md).
 *
 * TODO(eas-synced-seed-model-resolution): not implemented yet. Returns undefined, so callers fall
 * back to the name, which throws AmbiguousModelError when the name is ambiguous.
 */
export const resolveModelForSyncedSeed = async (_seed: SyncedSeedInfo): Promise<string | undefined> => {
  return undefined
}

/**
 * Run background work for one seed; if it hits an ambiguous model name, log, emit
 * MODEL_AMBIGUOUS_EVENT and return undefined (skip) instead of failing the whole job. Loading the
 * item directly still throws, so the problem surfaces where the app touches it.
 */
export const skipSeedOnAmbiguousModel = async <T>(
  seed: { seedLocalId?: string | null; seedUid?: string | null },
  context: string,
  work: () => Promise<T>,
): Promise<T | undefined> => {
  try {
    return await work()
  } catch (error) {
    if (!(error instanceof AmbiguousModelError)) throw error
    logger(`Skipping seed ${seed.seedLocalId ?? seed.seedUid} in ${context}: ${error.message}`)
    const payload: ModelAmbiguousEventPayload = {
      modelName: error.modelName,
      schemaNames: error.schemaNames,
      seedLocalId: seed.seedLocalId ?? undefined,
      seedUid: seed.seedUid ?? undefined,
      context,
    }
    eventEmitter.emit(MODEL_AMBIGUOUS_EVENT, payload)
    return undefined
  }
}

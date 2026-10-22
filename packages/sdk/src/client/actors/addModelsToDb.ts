import { inDefinitionsTransaction, insertModelStubs } from '@/db/write/definitions'
import { writeModelUids } from '@/db/write/writeModelUids'
import { localModelSchemaLookups } from '@/db/read/localModelSchemaLookups'
import { matchEasModelSchemas } from '@seedprotocol/eas'
import { BaseDb } from '@/db/Db/BaseDb'
import { loadNameMatchLevels } from '@/db/read/nameMatchLevels'
import { isTestOrSeedDev } from '@/helpers/environment'
import { ClientManagerContext } from '@/types/machines'
import debug from 'debug'
import { withSeedDbLock } from '@/helpers/tabLocks'
import { createRetryWhenOnline } from '@/helpers/retryWhenOnline'

const logger = debug('seedSdk:client:actors:addModelsToDb')

type ModelRow = { id: number; name: string; schemaFileId: string | null }

/**
 * Returns every `models` row named in `modelNames`, inserting a null-schemaFileId stub for each name
 * with no row yet (the schema import adopts stubs via findOrCreateModelRow). Check-then-insert:
 * another tab initializing at the same time would insert the same stubs, so tabs take turns
 * (docs/MULTI_TAB.md), and the check and insert are one transaction.
 */
export async function ensureModelStubs(modelNames: string[], filesDir: string | undefined): Promise<ModelRow[]> {
  return withSeedDbLock('init', filesDir, () =>
    inDefinitionsTransaction((tx) => insertModelStubs(tx, modelNames)),
  )
}

/** Retries the latest init's EAS schema lookup (see retryWhenOnline). */
let retryModelUidsLookup: (() => Promise<void>) | undefined
const modelUidsRetry = createRetryWhenOnline(() => void retryModelUidsLookup?.())

/**
 * Init step: makes sure every model in the context has a row, starts the background EAS lookup of
 * their schema uids, and loads the nameMatch levels.
 */
export async function addModelsToDb(context: ClientManagerContext): Promise<void> {
  const { models } = context

  const _addModelsToDb = async () => {
    const appDb = BaseDb.getAppDb()

    if (!appDb) {
      throw new Error('Database not ready')
    }

    if (!models) {
      return
    }

    // Internal models (Seed, Version, Metadata) are now loaded via SEEDPROTOCOL_Seed_Protocol_v1.json schema
    // They should already be in context.models from processSchemaFiles
    const allModels = { ...models }
    const modelNames = Object.keys(allModels)

    if (modelNames.length === 0) {
      return
    }

    // Models with a row, whose EAS schema uids are looked up below
    const modelNamesWithRows = new Set<string>()

    // Model names are only unique per schema, so match each Model by its id (schemaFileId) first.
    const existingModels = await ensureModelStubs(modelNames, context.filesDir)

    const rowFor = (modelName: string): ModelRow | undefined => {
      const modelFileId = (allModels[modelName] as { id?: string } | undefined)?.id
      const sameName = existingModels.filter((m) => m.name === modelName)
      return (
        (modelFileId ? sameName.find((m) => m.schemaFileId === modelFileId) : undefined) ??
        (sameName.length === 1 ? sameName[0] : undefined) ??
        sameName.find((m) => !m.schemaFileId)
      )
    }
    let hasModelsInDb = true
    for (const modelName of modelNames) {
      const foundModel = rowFor(modelName)
      if (!foundModel) {
        logger('[client/actors] [addModelsToDb] Warning: Could not find or create model:', modelName)
        hasModelsInDb = false
        continue
      }
      modelNamesWithRows.add(modelName)
    }

    // If we have no models to process, still send success (empty models is valid)
    if (modelNamesWithRows.size === 0) {
      logger('[client/actors] [addModelsToDb] No models to process, but continuing')
      return
    }

    // Fetch schemas from EAS in background - do not block init. EAS can be slow (10s+);
    // modelUids will be populated async and EAS sync orchestrator runs when done.
    const fetchEasAndPopulateModelUids = async () => {
      try {
        let timeout: ReturnType<typeof setTimeout> | undefined
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('EAS query timeout after 10 seconds')), 10000)
        })

        // The lookup and the model_uids rule sync uses too (each name at its nameMatch level).
        const { getModelSchemasFromEas } = await import('@/eas')
        const lookups = await localModelSchemaLookups([...modelNamesWithRows])
        // Cleared, so a finished lookup doesn't keep a Node process alive for 10 s.
        const schemas = await Promise.race([getModelSchemasFromEas(lookups), timeoutPromise]).finally(() =>
          clearTimeout(timeout),
        )
        const matches = matchEasModelSchemas(schemas, lookups)
        modelUidsRetry.succeeded()

        if (matches.length > 0) {
          await writeModelUids(matches)
          const { requestEasSyncFromModelsInit } = await import(
            '@/events/item/easSyncManager'
          )
          requestEasSyncFromModelsInit()
        } else {
          logger('[client/actors] [addModelsToDb] No schemas found from EAS, but continuing')
        }
      } catch (error: any) {
        if (isTestOrSeedDev()) {
          logger('[client/actors] [addModelsToDb] Warning: Could not fetch schemas from EAS (background):', error.message)
        } else {
          logger('[client/actors] [addModelsToDb] Error fetching schemas (background):', error.message)
        }
        // Probably offline: the startup sync waits for this lookup, so try again.
        modelUidsRetry.schedule()
      }
    }

    retryModelUidsLookup = fetchEasAndPopulateModelUids
    modelUidsRetry.cancel()
    fetchEasAndPopulateModelUids()

    return hasModelsInDb
  }

  try {
    await _addModelsToDb()
    // Model.findByModelType reads the nameMatch levels synchronously: have them before init is ready.
    await loadNameMatchLevels().catch((error) => {
      logger('[client/actors] [addModelsToDb] Could not load nameMatch levels:', error)
    })
  } catch (error) {
    logger('[client/actors] [addModelsToDb] Error:', error)
    // In test environments, initialization completes anyway
    if (!isTestOrSeedDev()) throw error
  }
}

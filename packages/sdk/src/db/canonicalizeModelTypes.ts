import { eq, isNotNull } from 'drizzle-orm'
import debug from 'debug'
import { easName, localNamesInBestMatchTier } from '@seedprotocol/eas'
import { BaseDb } from '@/db/Db/BaseDb'
import { loadNameMatchLevels } from '@/db/read/nameMatchLevels'
import { metadata, models, seeds, versions } from '@/seedSchema'
import { isLeaderTab, whenLeaderTab, withDbTabLock } from '@/helpers/tabCoordinator'

const logger = debug('seedSdk:db:canonicalizeModelTypes')

/**
 * Model types in the local DB (`seeds.type`, `versions.seed_type`, `metadata.model_type`) are the
 * EAS name of the model (ADR 0008): `html_page` for HTMLPage. Rows written before that hold other
 * forms: drizzle's snake_case for local seeds (`image_v_2`), or the name an older SDK published,
 * for synced ones (`htmlpage`). This rewrites each stored type that matches exactly one local model
 * name (in the tightest tier its nameMatch level allows, as sync matches) to that model's type.
 * Types matching no model, or several, are left alone. Returns the number of types rewritten.
 */
export async function canonicalizeModelTypes(): Promise<number> {
  const appDb = BaseDb.getAppDb()
  const modelNames = ((await appDb.selectDistinct({ name: models.name }).from(models)) as { name: string }[])
    .map((row) => row.name)
    .filter(Boolean)
  if (modelNames.length === 0) return 0
  // Each model name at its nameMatch level (ADR 0009). Read fresh: this runs after a schema load.
  const levels = await loadNameMatchLevels(appDb)

  const storedTypes = new Set<string>()
  const collect = (rows: { type: string | null }[]) => {
    for (const row of rows) if (row.type) storedTypes.add(row.type)
  }
  collect(await appDb.selectDistinct({ type: seeds.type }).from(seeds).where(isNotNull(seeds.type)))
  collect(await appDb.selectDistinct({ type: versions.seedType }).from(versions).where(isNotNull(versions.seedType)))
  collect(await appDb.selectDistinct({ type: metadata.modelType }).from(metadata).where(isNotNull(metadata.modelType)))

  let rewritten = 0
  for (const type of storedTypes) {
    const canonical = new Set(
      [...localNamesInBestMatchTier(type, modelNames, { level: (name) => levels.model(name) })].map((name) => easName(name)),
    )
    if (canonical.size !== 1) continue
    const [next] = canonical
    if (!next || next === type) continue
    await appDb.update(seeds).set({ type: next }).where(eq(seeds.type, type))
    await appDb.update(versions).set({ seedType: next }).where(eq(versions.seedType, type))
    await appDb.update(metadata).set({ modelType: next }).where(eq(metadata.modelType, type))
    logger(`model type ${type} → ${next}`)
    rewritten++
  }
  return rewritten
}

let running: Promise<void> | undefined
let deferredUntilLeader = false

const runInBackground = (): Promise<void> => {
  // Under the sync's lock: sync writes these columns too.
  running ??= withDbTabLock('eas-sync', () => canonicalizeModelTypes(), { timeoutMs: Infinity })
    .then(() => undefined)
    .catch((error) => {
      // Never fails init: readers still match old types by name, only exact type filters miss them.
      logger('canonicalizing model types failed', error)
    })
    .finally(() => {
      running = undefined
    })
  return running
}

/**
 * Starts {@link canonicalizeModelTypes} in the background after client init, in the leader tab
 * (docs/MULTI_TAB.md). It runs on every init: it reads only the distinct stored types, and a
 * model added since the last run may match types that matched nothing before. Never throws.
 */
export function startCanonicalizeModelTypes(): void {
  if (isLeaderTab()) {
    void runInBackground()
    return
  }
  if (deferredUntilLeader) return
  deferredUntilLeader = true
  void whenLeaderTab().then(() => {
    deferredUntilLeader = false
    void runInBackground()
  })
}

/** Resolves when a background run has finished (at once if none is running). */
export function whenCanonicalizeModelTypesSettled(): Promise<void> {
  return running ?? Promise.resolve()
}

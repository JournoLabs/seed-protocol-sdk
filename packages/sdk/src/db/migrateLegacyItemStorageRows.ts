import { and, eq, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm'
import debug from 'debug'
import { BaseDb } from '@/db/Db/BaseDb'
import { appState, metadata, models, properties, type MetadataType, type PropertyType } from '@/seedSchema'
import { resolveItemModelFileId } from '@/db/read/resolveModelRecord'
import { compareMetadataRowsLatestFirst } from '@/helpers/compareMetadataRowsLatestFirst'
import {
  convertVerbatimItemStorageRow,
  isVerbatimItemStorageDraftRow,
} from '@/db/write/convertVerbatimItemStorageRow'
import { isLeaderTab, whenLeaderTab, withDbTabLock } from '@/helpers/tabCoordinator'

const logger = debug('seedSdk:db:migrateLegacyItemStorageRows')

/** appState key recording that legacy ItemStorage rows have been written to their files. */
export const LEGACY_ITEM_STORAGE_MIGRATION_KEY = 'legacyItemStorageFiles:v1'

/** Runs in a row that left rows unconverted because a file write failed, before giving up. */
export const LEGACY_ITEM_STORAGE_MIGRATION_MAX_ATTEMPTS = 3

export type LegacyItemStorageMigrationMarker = {
  status: 'done' | 'retry'
  attempts: number
  converted: number
  failed: number
  at: number
}

export type LegacyItemStorageMigrationResult = {
  /** True when the marker said the migration had already run (nothing was checked). */
  alreadyDone: boolean
  /** Legacy rows found (local drafts of ItemStorage properties holding their content verbatim). */
  candidates: number
  converted: number
  /** Rows left as they were because writing the file or updating the row failed. */
  failed: number
  /** Rows not converted on purpose: an older row of their property, or one that changed meanwhile. */
  skipped: number
}

type StorageColumns = Pick<PropertyType, 'storageType' | 'localStorageDir' | 'filenameSuffix'>

const readMarker = async (): Promise<LegacyItemStorageMigrationMarker | undefined | null> => {
  const db = BaseDb.getAppDb()
  const rows = await db
    .select({ value: appState.value })
    .from(appState)
    .where(eq(appState.key, LEGACY_ITEM_STORAGE_MIGRATION_KEY))
    .limit(1)
  if (!rows.length) return undefined
  try {
    return JSON.parse(rows[0].value ?? '') as LegacyItemStorageMigrationMarker
  } catch {
    return null
  }
}

const writeMarker = async (marker: LegacyItemStorageMigrationMarker): Promise<void> => {
  const db = BaseDb.getAppDb()
  const now = Date.now()
  const value = JSON.stringify(marker)
  await db
    .insert(appState)
    .values({ key: LEGACY_ITEM_STORAGE_MIGRATION_KEY, value, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: appState.key, set: { value, updatedAt: now } })
}

/**
 * The storage settings of a metadata row's property: by its property_id, else by name in the
 * seed's own model (model names are only unique per schema). Undefined when it can't be told.
 */
const createStorageResolver = () => {
  const db = BaseDb.getAppDb()
  const byPropertyId = new Map<number, StorageColumns | undefined>()
  const byModelAndName = new Map<string, StorageColumns | undefined>()

  return async (row: MetadataType): Promise<StorageColumns | undefined> => {
    if (row.propertyId != null) {
      if (!byPropertyId.has(row.propertyId)) {
        const found = await db
          .select({
            storageType: properties.storageType,
            localStorageDir: properties.localStorageDir,
            filenameSuffix: properties.filenameSuffix,
          })
          .from(properties)
          .where(eq(properties.id, row.propertyId))
          .limit(1)
        byPropertyId.set(row.propertyId, found[0])
      }
      const fromId = byPropertyId.get(row.propertyId)
      if (fromId) return fromId
    }

    const modelFileId = await resolveItemModelFileId({ seedLocalId: row.seedLocalId, seedUid: row.seedUid })
    if (!modelFileId || !row.propertyName) return undefined
    const key = `${modelFileId}\u0000${row.propertyName}`
    if (!byModelAndName.has(key)) {
      const found = await db
        .select({
          storageType: properties.storageType,
          localStorageDir: properties.localStorageDir,
          filenameSuffix: properties.filenameSuffix,
        })
        .from(properties)
        .innerJoin(models, eq(properties.modelId, models.id))
        .where(and(eq(models.schemaFileId, modelFileId), eq(properties.name, row.propertyName)))
        .limit(1)
      byModelAndName.set(key, found[0])
    }
    return byModelAndName.get(key)
  }
}

/** True if `row` is the row readers show for its property: the newest of its seed's rows by that name. */
const isNewestRowOfProperty = async (row: MetadataType): Promise<boolean> => {
  if (!row.seedLocalId || !row.propertyName) return false
  const db = BaseDb.getAppDb()
  const siblings: MetadataType[] = await db
    .select()
    .from(metadata)
    .where(and(eq(metadata.seedLocalId, row.seedLocalId), eq(metadata.propertyName, row.propertyName)))
  return [...siblings].sort(compareMetadataRowsLatestFirst)[0]?.localId === row.localId
}

/**
 * One-time data migration: writes the content of legacy ItemStorage draft rows to their files.
 *
 * Before Item.create / createNewItem saved ItemStorage values through the save pipeline, a value
 * given at creation was stored verbatim in metadata.property_value with no file. Publish converts
 * such a row lazily (resolveItemStorageChildFile); this converts them all up front, with the same
 * code ({@link convertVerbatimItemStorageRow}), so every ItemStorage draft has the shape a save
 * gives it: the content in `<seedUid or seedLocalId><extension>`, the row holding
 * refResolvedValue / localStorageDir / refValueType 'file' and no property_value.
 *
 * Only local drafts (no uid, not derived from an attestation) of properties whose properties row
 * says `storage_type = 'ItemStorage'` are touched, and of those only the newest row of each
 * seed's property: that is the row reads show and saves write to, and older rows sharing the one
 * file name would overwrite it with older content. Published and synced rows are never changed.
 *
 * A row that fails is logged and left as it was (publish still converts it). The run is recorded
 * in appState under {@link LEGACY_ITEM_STORAGE_MIGRATION_KEY}; a run with failed rows is retried
 * on the next start, up to {@link LEGACY_ITEM_STORAGE_MIGRATION_MAX_ATTEMPTS} runs. Safe to run
 * again regardless: a converted row no longer matches.
 *
 * @param options.force run even when the marker says it is done
 */
export async function migrateLegacyItemStorageRows(
  options: { force?: boolean } = {},
): Promise<LegacyItemStorageMigrationResult> {
  const result: LegacyItemStorageMigrationResult = {
    alreadyDone: false,
    candidates: 0,
    converted: 0,
    failed: 0,
    skipped: 0,
  }
  const db = BaseDb.getAppDb()
  if (!db) return { ...result, alreadyDone: true }

  const marker = await readMarker()
  const previousAttempts = marker?.status === 'retry' ? marker.attempts : 0
  if (!options.force && marker && marker.status === 'done') {
    return { ...result, alreadyDone: true }
  }

  const itemStorageNames = (
    (await db
      .selectDistinct({ name: properties.name })
      .from(properties)
      .where(eq(properties.storageType, 'ItemStorage'))) as { name: string }[]
  ).map((r) => r.name)

  const candidates: MetadataType[] = itemStorageNames.length
    ? await db
        .select()
        .from(metadata)
        .where(
          and(
            inArray(metadata.propertyName, itemStorageNames),
            or(isNull(metadata.uid), eq(metadata.uid, '')),
            isNull(metadata.derivedFromUid),
            isNull(metadata.refResolvedValue),
            isNotNull(metadata.propertyValue),
            ne(metadata.propertyValue, ''),
          ),
        )
    : []

  const resolveStorage = createStorageResolver()

  for (const row of candidates) {
    if (!row.localId || !isVerbatimItemStorageDraftRow(row)) continue
    try {
      const storage = await resolveStorage(row)
      if (storage?.storageType !== 'ItemStorage') continue
      result.candidates++
      if (!(await isNewestRowOfProperty(row))) {
        result.skipped++
        continue
      }
      const converted = await convertVerbatimItemStorageRow(row.localId, {
        localStorageDir: storage.localStorageDir,
        filenameSuffix: storage.filenameSuffix,
      })
      if (converted) {
        result.converted++
        logger(`wrote ${row.propertyName} of ${row.seedLocalId} to ${converted.filePath}`)
      } else {
        result.skipped++
      }
    } catch (error) {
      result.failed++
      logger(`converting ${row.propertyName} of ${row.seedLocalId} (${row.localId}) failed; left as is`, error)
    }
  }

  const attempts = previousAttempts + 1
  await writeMarker({
    status: result.failed > 0 && attempts < LEGACY_ITEM_STORAGE_MIGRATION_MAX_ATTEMPTS ? 'retry' : 'done',
    attempts,
    converted: result.converted,
    failed: result.failed,
    at: Date.now(),
  })

  if (result.candidates > 0) {
    logger(
      `legacy ItemStorage rows: ${result.converted} converted, ${result.failed} failed, ` +
        `${result.skipped} skipped of ${result.candidates}`,
    )
  }
  return result
}

let running: Promise<void> | undefined
let deferredUntilLeader = false

const runInBackground = (): Promise<void> => {
  running ??= withDbTabLock('item-storage-migration', () => migrateLegacyItemStorageRows())
    .then(() => undefined)
    .catch((error) => {
      // Never fails init: rows stay as they were and publish converts them lazily.
      logger('legacy ItemStorage migration failed', error)
    })
    .finally(() => {
      running = undefined
    })
  return running
}

/**
 * Starts {@link migrateLegacyItemStorageRows} in the background once client init has finished
 * (the properties table then holds the current storage settings). It runs in the leader tab only
 * (docs/MULTI_TAB.md), under a `seed:item-storage-migration:<db>` lock in case several tabs lead
 * (`multiTab: 'off'`); a tab that isn't leader runs it if it takes over. Never throws.
 */
export function startLegacyItemStorageMigration(): void {
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

/** Resolves when a background run started by {@link startLegacyItemStorageMigration} has finished (at once if none is running). */
export function whenLegacyItemStorageMigrationSettled(): Promise<void> {
  return running ?? Promise.resolve()
}

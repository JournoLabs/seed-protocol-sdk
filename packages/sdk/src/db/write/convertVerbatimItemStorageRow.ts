import { and, eq, isNull } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata, type MetadataType } from '@/seedSchema'
import {
  getItemStorageFilePath,
  withLockedItemStorageRow,
  writeItemStorageFile,
} from '@/helpers/itemStorageFile'

type VerbatimRowFields = Pick<
  MetadataType,
  'uid' | 'derivedFromUid' | 'refResolvedValue' | 'propertyValue'
>

/**
 * A legacy ItemStorage draft row: a local edit (no attestation uid, not derived from one) that holds
 * the content itself in property_value, with no file reference. Item.create / createNewItem stored
 * ItemStorage values like this before they went through the save pipeline.
 */
export const isVerbatimItemStorageDraftRow = (row: VerbatimRowFields): boolean =>
  !row.uid &&
  row.derivedFromUid == null &&
  !row.refResolvedValue &&
  typeof row.propertyValue === 'string' &&
  row.propertyValue !== ''

export type ItemStorageRowStorage = {
  /** The property's `storage.path` (e.g. `/html`); the row's own localStorageDir, else `files`, when unset. */
  localStorageDir?: string | null
  /** The property's `storage.extension` (e.g. `.html`). */
  filenameSuffix?: string | null
  /** Seed id to name the file after; the row's seedUid, else its seedLocalId, when unset. */
  seedId?: string | null
}

export type ConvertedItemStorageRow = {
  fileName: string
  filePath: string
  localStorageDir: string
  /** The content now in the file (the row's former property_value). */
  content: string
}

/**
 * Convert one legacy ItemStorage draft row (see {@link isVerbatimItemStorageDraftRow}) into the
 * shape saveItemStorage gives a row: the content goes to the file a save would write
 * (`<seedUid or seedLocalId><extension>` in the property's storage directory), and the row records
 * `refResolvedValue`, `localStorageDir` and `refValueType: 'file'` with property_value cleared.
 * Used by publish (resolveItemStorageChildFile) and the one-time migration (migrateLegacyItemStorageRows).
 *
 * Reading the row, writing the file and updating the row happen under the file's lock
 * ({@link withItemStorageFileLock}), which saveItemStorage holds too: a save in this or another tab
 * either finishes before (the row, read again once the lock is held, is no longer legacy and is
 * left alone) or starts after (and overwrites the file and row with its content). Without the lock
 * a save landing between the read and the file write would have its file overwritten with the old
 * content. The row update also stays conditional on the row being unchanged, for writers that
 * don't take the lock (a tab still running an older SDK).
 *
 * Returns undefined when there was nothing to convert. Throws when the file can't be written; the
 * row is then unchanged.
 */
export const convertVerbatimItemStorageRow = async (
  localId: string,
  storage: ItemStorageRowStorage = {},
): Promise<ConvertedItemStorageRow | undefined> => {
  const appDb = BaseDb.getAppDb()
  if (!appDb || !localId) return undefined

  const targetOf = (row: MetadataType) => {
    if (!isVerbatimItemStorageDraftRow(row)) return undefined
    const seedId = storage.seedId || row.seedUid || row.seedLocalId
    if (!seedId) return undefined
    return {
      seedId,
      localStorageDir: storage.localStorageDir || row.localStorageDir,
      filenameSuffix: storage.filenameSuffix,
    }
  }

  return withLockedItemStorageRow(
    localId,
    (row) => {
      const target = targetOf(row)
      return target && getItemStorageFilePath(target)
    },
    async (row) => {
      const content = row.propertyValue as string
      const { fileName, filePath, localStorageDir } = await writeItemStorageFile(targetOf(row)!, content)

      await appDb
        .update(metadata)
        .set({ refResolvedValue: fileName, localStorageDir, refValueType: 'file', propertyValue: null })
        .where(
          and(
            eq(metadata.localId, localId),
            isNull(metadata.refResolvedValue),
            eq(metadata.propertyValue, content),
          ),
        )

      // Changed between the read and the update by a writer outside the lock: that change stands.
      const after: Pick<MetadataType, 'refResolvedValue' | 'propertyValue'>[] = await appDb
        .select({ refResolvedValue: metadata.refResolvedValue, propertyValue: metadata.propertyValue })
        .from(metadata)
        .where(eq(metadata.localId, localId))
        .limit(1)
      if (after[0]?.refResolvedValue !== fileName || after[0]?.propertyValue != null) return undefined

      return { fileName, filePath, localStorageDir, content }
    },
  )
}

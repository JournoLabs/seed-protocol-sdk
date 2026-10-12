import { and, eq, isNull } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata, type MetadataType } from '@/seedSchema'
import { writeItemStorageFile } from '@/helpers/itemStorageFile'

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
 * The row is read again first, and the update only applies while it is still the same legacy row,
 * so a row converted or saved in the meantime is left alone. Returns undefined when there was
 * nothing to convert. Throws when the file can't be written; the row is then unchanged.
 */
export const convertVerbatimItemStorageRow = async (
  localId: string,
  storage: ItemStorageRowStorage = {},
): Promise<ConvertedItemStorageRow | undefined> => {
  const appDb = BaseDb.getAppDb()
  if (!appDb || !localId) return undefined

  const rows: MetadataType[] = await appDb
    .select()
    .from(metadata)
    .where(eq(metadata.localId, localId))
    .limit(1)
  const row = rows[0]
  if (!row || !isVerbatimItemStorageDraftRow(row)) return undefined

  const seedId = storage.seedId || row.seedUid || row.seedLocalId
  if (!seedId) return undefined

  const content = row.propertyValue as string
  const { fileName, filePath, localStorageDir } = await writeItemStorageFile(
    {
      seedId,
      localStorageDir: storage.localStorageDir || row.localStorageDir,
      filenameSuffix: storage.filenameSuffix,
    },
    content,
  )

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

  // Changed between the read and the update (e.g. a save in another tab): that change stands.
  const after: Pick<MetadataType, 'refResolvedValue' | 'propertyValue'>[] = await appDb
    .select({ refResolvedValue: metadata.refResolvedValue, propertyValue: metadata.propertyValue })
    .from(metadata)
    .where(eq(metadata.localId, localId))
    .limit(1)
  if (after[0]?.refResolvedValue !== fileName || after[0]?.propertyValue != null) return undefined

  return { fileName, filePath, localStorageDir, content }
}

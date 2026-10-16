import { eq } from 'drizzle-orm'
import debug from 'debug'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata } from '@/seedSchema'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { hardDeleteLocalSeedsByLocalIds } from '@/db/write/removeLocalCopiesForAddresses'

const logger = debug('seedSdk:db:write:discardNewDraft')

/** Storage seeds a property row points at: Html, Image and File values are seeds of their own. */
const STORAGE_REF_TYPES = new Set(['html', 'image', 'file'])

/**
 * Removes a draft that Item.create wrote and then failed to finish: the seed, its versions and
 * property rows, the storage seeds its property rows point at (Html, Image, File), and the files
 * those rows name. Only for a seed created in this call: it deletes rows, it doesn't soft-delete.
 * File deletion is best-effort.
 */
export async function discardNewDraft(seedLocalId: string): Promise<void> {
  const appDb = BaseDb.getAppDb()
  if (!appDb) return

  const rows = await appDb
    .select({
      propertyValue: metadata.propertyValue,
      refSeedType: metadata.refSeedType,
      refResolvedValue: metadata.refResolvedValue,
      localStorageDir: metadata.localStorageDir,
    })
    .from(metadata)
    .where(eq(metadata.seedLocalId, seedLocalId))

  const childSeedLocalIds: string[] = []
  const filePaths: string[] = []
  for (const row of rows) {
    if (row.refSeedType && STORAGE_REF_TYPES.has(row.refSeedType) && row.propertyValue) {
      childSeedLocalIds.push(row.propertyValue)
    }
    if (row.localStorageDir && row.refResolvedValue) {
      filePaths.push(BaseFileManager.getFilesPath(row.localStorageDir, row.refResolvedValue))
    }
  }

  await hardDeleteLocalSeedsByLocalIds([seedLocalId, ...childSeedLocalIds])

  if (filePaths.length === 0) return
  try {
    const fs = await BaseFileManager.getFs()
    for (const filePath of filePaths) {
      try {
        if (fs?.promises?.unlink) await fs.promises.unlink(filePath)
        else fs?.unlinkSync?.(filePath)
      } catch (error) {
        logger(`could not delete ${filePath}`, error)
      }
    }
  } catch (error) {
    logger('could not delete files', error)
  }
}

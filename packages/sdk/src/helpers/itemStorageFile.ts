import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { getItemStorageLocalFileName, getItemStorageSubdir } from '@/helpers/storageDir'

export type ItemStorageFileTarget = {
  /** The item's seedUid, else its seedLocalId: the file is `<seedId><extension>`. */
  seedId: string
  /** The property's `storage.path` (e.g. `/html`); `files` when unset. */
  localStorageDir?: string | null
  /** The property's `storage.extension` (e.g. `.html`). */
  filenameSuffix?: string | null
  /** An existing file name to write to instead (the row's refResolvedValue). */
  fileName?: string | null
}

/**
 * Write an ItemStorage property's content to its local file, where saveItemStorage, reads, publish
 * (resolveItemStorageChildFile) and download all look for it. Returns what the metadata row records:
 * `refResolvedValue` (the file name) and `localStorageDir` (with a leading slash).
 */
export const writeItemStorageFile = async (
  target: ItemStorageFileTarget,
  content: string | Blob | ArrayBuffer,
): Promise<{ fileName: string; filePath: string; localStorageDir: string }> => {
  const dir = getItemStorageSubdir(target.localStorageDir)
  const fileName = target.fileName || getItemStorageLocalFileName(target.seedId, target.filenameSuffix)
  await BaseFileManager.createDirIfNotExists(BaseFileManager.getFilesPath(dir))
  const filePath = BaseFileManager.getFilesPath(dir, fileName)
  await BaseFileManager.saveFile(filePath, content)
  return { fileName, filePath, localStorageDir: target.localStorageDir || `/${dir}` }
}

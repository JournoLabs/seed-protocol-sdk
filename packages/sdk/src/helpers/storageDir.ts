import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { normalizeDataType } from '@/helpers/property'

/** Subdirectory of the files root that holds a storage seed's file, by its data type. */
export const getStorageSubdirForDataType = (
  dataType: string | null | undefined,
): 'images' | 'files' | 'html' | 'json' => {
  switch (normalizeDataType(dataType ?? undefined)) {
    case 'Image':
      return 'images'
    case 'Html':
      return 'html'
    case 'Json':
      return 'json'
    case 'File':
    default:
      // Unknown types are generic files; `images/` is only for what the SDK knows is an image.
      return 'files'
  }
}

/** Absolute directory for a storage seed's file (`images/`, `files/`, `html/` or `json/` under the files root). */
export const getStorageDirForDataType = (dataType: string | null | undefined): string =>
  BaseFileManager.getFilesPath(getStorageSubdirForDataType(dataType))

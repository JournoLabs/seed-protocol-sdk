import { BaseFileManager } from "@/helpers";
import { ClientManagerContext } from "@/types/machines";

/** Init step: prepares the file system under `filesDir`. */
export async function fileSystemInit({ filesDir }: ClientManagerContext): Promise<void> {
  if (!filesDir) {
    throw new Error('filesDir is required')
  }
  await BaseFileManager.initializeFileSystem(filesDir)
}

import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { INTERNAL_SCHEMA_IDS, SEED_PROTOCOL_SCHEMA_NAME } from '@/helpers/constants'

const SANITIZED_SEED_PROTOCOL_NAME = SEED_PROTOCOL_SCHEMA_NAME.replace(/\s+/g, '_')

/**
 * True for a schema JSON file that client.init would import from the working dir and that isn't the
 * internal Seed Protocol schema. Matches both formats init reads:
 * - complete: `{schemaFileId}_{schemaName}_v{version}.json`
 * - minimal:  `{name}-v{version}.json`
 */
export function isTestSchemaFileName(fileName: string): boolean {
  const complete = fileName.match(/^(.+?)_(.+)_v\d+\.json$/)
  if (complete) {
    const [, schemaFileId, schemaName] = complete
    return !(INTERNAL_SCHEMA_IDS as readonly string[]).includes(schemaFileId) && schemaName !== SANITIZED_SEED_PROTOCOL_NAME
  }
  const minimal = fileName.match(/^(.+)-v\d+\.json$/)
  if (minimal) {
    return minimal[1] !== SEED_PROTOCOL_SCHEMA_NAME && minimal[1] !== SANITIZED_SEED_PROTOCOL_NAME
  }
  return false
}

/**
 * Deletes test schema JSON files from the working dir via the SDK's file system. Needs an initialized
 * client; does nothing otherwise.
 *
 * Browser test files share one OPFS store, and client.init imports every schema file it finds in the
 * working dir. Deleting only a test's DB rows therefore isn't enough: the next file's init re-imports
 * the leftover files (bringing back their schemas and models) and gets slower with each one.
 */
export async function cleanupTestSchemaFiles(): Promise<void> {
  let workingDir: string
  try {
    workingDir = BaseFileManager.getWorkingDir()
  } catch {
    return
  }
  try {
    const fs = await BaseFileManager.getFs()
    const path = BaseFileManager.getPathModule()
    const files: string[] = await fs.promises.readdir(workingDir)
    for (const file of files) {
      if (isTestSchemaFileName(file)) {
        await fs.promises.unlink(path.join(workingDir, file)).catch(() => {})
      }
    }
  } catch {
    // Working dir may not exist yet
  }
}

/**
 * Browser only: deletes test schema files a previous test file left in OPFS, before client.init
 * (the SDK file system isn't set up yet, so this uses the OPFS API directly).
 */
export async function cleanupLeftoverOpfsSchemaFiles(filesDir: string): Promise<number> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return 0
  let dir: FileSystemDirectoryHandle = await navigator.storage.getDirectory()
  try {
    for (const segment of filesDir.split('/').filter(Boolean)) {
      dir = await dir.getDirectoryHandle(segment)
    }
  } catch {
    return 0
  }
  const toDelete: string[] = []
  for await (const [name, handle] of (dir as any).entries() as AsyncIterable<[string, FileSystemHandle]>) {
    if (handle.kind === 'file' && isTestSchemaFileName(name)) toDelete.push(name)
  }
  for (const name of toDelete) {
    await dir.removeEntry(name).catch(() => {})
  }
  return toDelete.length
}

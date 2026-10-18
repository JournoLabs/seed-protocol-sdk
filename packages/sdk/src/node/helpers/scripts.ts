import { execSync } from 'child_process'
import path from 'path'
import fs from 'fs'
import { BaseDb } from '@/db/Db/BaseDb'

export const commandExists = (command: string): boolean => {
  try {
    execSync(`which ${command}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * Finds the seed binary path, trying multiple locations
 * @returns The path to the seed binary, or null if not found
 */
export const findSeedBinary = (): string | null => {
  const cwd = process.cwd()

  const possiblePaths = [
    path.join(cwd, 'node_modules', '.bin', 'seed'),
    path.join(cwd, 'node_modules', '@seedprotocol', 'cli', 'dist', 'bin.js'),
    path.join(cwd, '..', 'node_modules', '.bin', 'seed'),
    path.join(cwd, '..', 'node_modules', '@seedprotocol', 'cli', 'dist', 'bin.js'),
    path.join(cwd, '..', '..', 'node_modules', '.bin', 'seed'),
    path.join(cwd, '..', '..', 'node_modules', '@seedprotocol', 'cli', 'dist', 'bin.js'),
  ]

  for (const binPath of possiblePaths) {
    if (fs.existsSync(binPath)) {
      return binPath
    }
  }

  return null
}

/**
 * Ensures the Node app DB exists and SDK migrations are applied.
 * (Formerly `runSeedInit`; its CLI spawn / npx fallbacks were removed in 0.5.0, see docs/adr/0018-fixed-sdk-tables-no-runtime-codegen.md.)
 */
export const ensureNodeDbSchema = async (
  _schemaFileDir?: string,
  appFilesDirPath?: string
): Promise<void> => {
  if (!appFilesDirPath) {
    throw new Error('ensureNodeDbSchema requires appFilesDirPath')
  }

  await BaseDb.prepareDb(appFilesDirPath)
}

/** @deprecated Use ensureNodeDbSchema */
export const runSeedInit = ensureNodeDbSchema

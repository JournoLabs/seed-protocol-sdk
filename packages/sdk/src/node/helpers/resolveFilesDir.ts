import fs from 'fs'
import path from 'path'
import { BasePathResolver } from '@/helpers/PathResolver/BasePathResolver'
import { isUnderDotSeed } from '@/helpers/dotSeedPath'

/**
 * The filesDir to use on Node, resolved relative to the .seed directory at the project root
 * (created if missing). A browser OPFS-style path such as '/app-files' that doesn't exist on
 * disk becomes '.seed/app-files'; a relative path not already under .seed is joined to .seed;
 * other absolute paths are used as-is.
 */
export function resolveFilesDir(filesDir: string): string {
  const dotSeedDir = BasePathResolver.getDotSeedDir()

  if (!fs.existsSync(dotSeedDir)) {
    fs.mkdirSync(dotSeedDir, { recursive: true })
  }

  // Browser OPFS paths are single-level, like '/app-files' or '/files'.
  const pathWithoutLeadingSlash = filesDir.slice(1)
  const isBrowserOpfsPath =
    path.isAbsolute(filesDir) &&
    filesDir.startsWith('/') &&
    pathWithoutLeadingSlash.length > 0 &&
    !pathWithoutLeadingSlash.includes('/') &&
    !fs.existsSync(filesDir)

  if (isBrowserOpfsPath) {
    return path.join(dotSeedDir, filesDir.slice(1) || 'app-files')
  }
  if (!path.isAbsolute(filesDir)) {
    return isUnderDotSeed(filesDir) ? path.resolve(filesDir) : path.join(dotSeedDir, filesDir)
  }
  return filesDir
}

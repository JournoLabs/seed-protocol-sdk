import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'

const isFile = async (path: string): Promise<boolean> => {
  try {
    const fs = await BaseFileManager.getFs()
    return (await fs.promises.stat(path)).isFile()
  } catch {
    return false
  }
}

/**
 * A file in `subdir` (relative to the files root) for a stored reference: the file of that exact
 * name, else the first whose name contains one of `needles` (a downloaded file is named after its
 * transaction id, sometimes with an extension). Folders (an image's size variants) don't count.
 */
export async function findFileInDir(subdir: string, needles: readonly (string | null | undefined)[]): Promise<string | undefined> {
  const wanted = needles.filter((n): n is string => !!n)
  if (wanted.length === 0) return undefined
  for (const needle of wanted) {
    const exact = BaseFileManager.getFilesPath(subdir, needle)
    if ((await BaseFileManager.pathExists(exact)) && (await isFile(exact))) return exact
  }
  const dirPath = BaseFileManager.getFilesPath(subdir)
  if (!(await BaseFileManager.pathExists(dirPath))) return undefined
  const fs = await BaseFileManager.getFs()
  const path = BaseFileManager.getPathModule()
  const names: string[] = await fs.promises.readdir(dirPath)
  for (const needle of wanted) {
    for (const name of names) {
      if (!path.basename(name).includes(needle)) continue
      const candidate = BaseFileManager.getFilesPath(subdir, name)
      if (await isFile(candidate)) return candidate
    }
  }
  return undefined
}

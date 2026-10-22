import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { assertBagPath, type Bag } from '../bag'

/**
 * Writes `bag` under `directory`, which must not exist or be empty, so a bag never mixes with
 * leftover files that its manifests don't list.
 */
export async function writeBagDirectory(bag: Bag, directory: string): Promise<void> {
  const existing = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  if (existing.length > 0) throw new Error(`${directory} is not empty`)
  for (const file of bag.files) {
    assertBagPath(file.path)
    const target = path.join(directory, ...file.path.split('/'))
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, file.bytes)
  }
}

/** Every file under `directory` as a bag, with `/`-separated paths. */
export async function readBagDirectory(directory: string): Promise<Bag> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true })
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const full = path.join(entry.parentPath, entry.name)
        return {
          path: path.relative(directory, full).split(path.sep).join('/'),
          bytes: new Uint8Array(await readFile(full)),
        }
      }),
  )
  return { files }
}

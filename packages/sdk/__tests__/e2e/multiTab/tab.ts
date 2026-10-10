/**
 * One app tab for browser/multiTab.e2e.test.ts: runs the real SDK client against the database
 * under `?filesDir=` and exposes `window.seedTab` for the test to drive through Playwright.
 */
import { sql } from 'drizzle-orm'
import { client } from '@/client'
import { BaseDb } from '@/db/Db/BaseDb'
import { eventEmitter } from '@/eventBus'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { isLeaderTab } from '@/helpers/tabCoordinator'
import { FILES_CHANGED_EVENT, notifyFilesWrittenOutsideCache } from '@/helpers/tabEvents'

const filesDir = new URLSearchParams(location.search).get('filesDir')
if (!filesDir) throw new Error('tab.html needs ?filesDir=')

const filesChanged: string[][] = []
eventEmitter.on(FILES_CHANGED_EVENT, (paths: string[]) => filesChanged.push(paths))

const db = () => {
  const appDb = BaseDb.getAppDb()
  if (!appDb) throw new Error('client not initialized')
  return appDb
}

const seedTab = {
  async init(): Promise<void> {
    await client.init({
      config: {
        models: {},
        endpoints: { filePaths: '/api/seed/migrations', files: filesDir },
        arweaveDomain: 'arweave.net',
        filesDir,
      },
      addresses: [],
    })
  },
  isLeader: () => isLeaderTab(),
  async appliedMigrations(): Promise<number> {
    const rows = await db().values<[number]>(sql`SELECT COUNT(*) FROM __drizzle_migrations`)
    return Number(rows[0][0])
  },
  async duplicateModelNames(): Promise<string[]> {
    const rows = await db().values<[string]>(sql`SELECT name FROM models GROUP BY name HAVING COUNT(*) > 1`)
    return rows.map(([name]) => name)
  },
  /** Like a download worker: writes straight to OPFS, then reports the path. */
  async writeOutsideCache(relativePath: string, text: string): Promise<string> {
    const segments = `${filesDir}/${relativePath}`.split('/').filter(Boolean)
    const fileName = segments.pop()!
    let dir = await navigator.storage.getDirectory()
    for (const segment of segments) dir = await dir.getDirectoryHandle(segment, { create: true })
    const writable = await (await dir.getFileHandle(fileName, { create: true })).createWritable()
    await writable.write(text)
    await writable.close()
    const absolute = `${filesDir}/${relativePath}`
    await notifyFilesWrittenOutsideCache([absolute])
    return absolute
  },
  readFile: (absolutePath: string) => BaseFileManager.readFileAsString(absolutePath),
  filesChanged: () => filesChanged,
}

declare global {
  interface Window {
    seedTab: typeof seedTab
    seedTabReady: boolean
  }
}

window.seedTab = seedTab
window.seedTabReady = true

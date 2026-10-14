/**
 * One app tab for browser/multiTab.e2e.test.ts: runs the real SDK client against the database
 * under `?filesDir=` and exposes `window.seedTab` for the test to drive through Playwright.
 */
import { sql } from 'drizzle-orm'
import { client } from '@/client'
import { BaseDb } from '@/db/Db/BaseDb'
import { eventEmitter } from '@/eventBus'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { isLeaderTab, TAB_ID } from '@/helpers/tabCoordinator'
import { FILES_CHANGED_EVENT, notifyFilesWrittenOutsideCache } from '@/helpers/tabEvents'

const filesDir = new URLSearchParams(location.search).get('filesDir')
if (!filesDir) throw new Error('tab.html needs ?filesDir=')

const filesChanged: string[][] = []
eventEmitter.on(FILES_CHANGED_EVENT, (paths: string[]) => filesChanged.push(paths))

/** Every files-changed message on this database's tab channel, from any tab (this one included). */
const filesChangedMessages: Array<{ from?: string; paths: string[] }> = []
new BroadcastChannel(`seed:tabs:${filesDir}/db/seed.db`).onmessage = (event) => {
  if (event.data?.type === 'files-changed') {
    filesChangedMessages.push({ from: event.data.from, paths: event.data.paths })
  }
}

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
  /** Through the SDK's file manager (async API); returns the absolute path. */
  async saveFile(relativePath: string, text: string): Promise<string> {
    const absolute = `${filesDir}/${relativePath}`
    await BaseFileManager.createDirIfNotExists(absolute.slice(0, absolute.lastIndexOf('/')))
    await BaseFileManager.saveFile(absolute, text)
    return absolute
  },
  /** Many saves at once, as schema processing or a migration does; returns the absolute paths. */
  async saveFiles(relativeDir: string, count: number, text: string): Promise<string[]> {
    const dir = `${filesDir}/${relativeDir}`
    await BaseFileManager.createDirIfNotExists(dir)
    const paths = Array.from({ length: count }, (_, i) => `${dir}/f${i}.txt`)
    await Promise.all(paths.map((path) => BaseFileManager.saveFile(path, text)))
    return paths
  },
  /** Through the sync API; the OPFS write lands after this returns. */
  saveFileSync(absolutePath: string, text: string): void {
    BaseFileManager.saveFileSync(absolutePath, text)
  },
  /** The sync API's in-memory copy only: no stat(), no invalidate. null when it has no such file. */
  readFileSync(absolutePath: string): Promise<string | null> {
    try {
      return BaseFileManager.readFileSync(absolutePath).text()
    } catch {
      return Promise.resolve(null)
    }
  },
  tabId: () => TAB_ID,
  filesChanged: () => filesChanged,
  filesChangedMessages: () => filesChangedMessages,
}

declare global {
  interface Window {
    seedTab: typeof seedTab
    seedTabReady: boolean
  }
}

window.seedTab = seedTab
window.seedTabReady = true

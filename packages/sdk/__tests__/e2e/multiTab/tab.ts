/**
 * One app tab for browser/multiTab.e2e.test.ts: runs the real SDK client against the database
 * under `?filesDir=` and exposes `window.seedTab` for the test to drive through Playwright.
 */
import { eq, sql } from 'drizzle-orm'
import { appState, metadata, seeds } from '@/seedSchema'
import { watchEntityChanges } from '@/browser/db/changeFeed'
import { Item } from '@/Item/Item'
import { importJsonSchema } from '@/imports/json'
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

/** Change-feed calls per watched seed local id. */
const changeCalls = new Map<string, number>()

/** Items this tab loaded, by seed local id. */
const loadedItems = new Map<string, Item<any>>()

/** Calls to the post-sync rehydrate, which only Node runs (decision D3). */
let rehydrateCalls = 0
const rehydrate = Item.rehydrateCachedItemsFromDbAfterEasSync.bind(Item)
Item.rehydrateCachedItemsFromDbAfterEasSync = async () => {
  rehydrateCalls++
  return rehydrate()
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
  resetLocalData: (options?: { otherTabsTimeoutMs?: number }) => client.resetLocalData(options),
  /** The client snapshot's status and, once stopped, why. */
  clientStatus(): { status: string; stopReason?: string } {
    const snapshot = client.getService().getSnapshot()
    return { status: snapshot.status, stopReason: snapshot.context.stopReason }
  },
  async seedCount(): Promise<number> {
    const rows = await db().values<[number]>(sql`SELECT COUNT(*) FROM seeds`)
    return Number(rows[0][0])
  },
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
  /**
   * Adds 1 to the appState counter `key`, `times` times, each a read-then-write BaseDb.transaction:
   * run in two tabs at once, any lost update or escaped SQLITE_BUSY shows in the total.
   */
  async incrementInTransactions(key: string, times: number): Promise<void> {
    for (let i = 0; i < times; i++) {
      await BaseDb.transaction(async (tx) => {
        const rows = await tx.select().from(appState).where(eq(appState.key, key))
        const next = String(Number(rows[0]?.value ?? 0) + 1)
        if (rows.length === 0) await tx.insert(appState).values({ key, value: next })
        else await tx.update(appState).set({ value: next }).where(eq(appState.key, key))
      })
    }
  },
  async counterValue(key: string): Promise<number> {
    const rows = await db().select().from(appState).where(eq(appState.key, key))
    return Number(rows[0]?.value ?? 0)
  },
  /** Inserts a seed row straight into the table, as a writer outside the outbox does; returns its local id. */
  async insertSeed(): Promise<string> {
    const localId = `tab-seed-${Math.random().toString(36).slice(2, 10)}`
    await db().insert(seeds).values({ localId, type: 'tab_post', createdAt: Date.now() })
    return localId
  },
  async touchSeed(localId: string): Promise<void> {
    await db().update(seeds).set({ updatedAt: Date.now() }).where(eq(seeds.localId, localId))
  },
  /** Counts this tab's change-feed calls for the seed's rows (ADR 0020). */
  watchSeed(localId: string): void {
    changeCalls.set(localId, 0)
    watchEntityChanges({ seedLocalId: localId, tables: ['seeds'] }, () =>
      changeCalls.set(localId, (changeCalls.get(localId) ?? 0) + 1),
    )
  },
  changeCalls: (localId: string) => changeCalls.get(localId) ?? 0,
  async importSchema(contents: string, version: number): Promise<void> {
    await importJsonSchema({ contents }, version)
  },
  /** Creates an item and waits for its version; returns its local ids. */
  async createItem(
    modelName: string,
    schemaName: string,
    values: Record<string, string>,
  ): Promise<{ seedLocalId: string; versionLocalId: string }> {
    const item = (await Item.create({ modelName, schemaName, ...values } as never)) as Item<any>
    const deadline = Date.now() + 10_000
    while (!item.latestVersionLocalId && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25))
    return { seedLocalId: item.seedLocalId, versionLocalId: item.latestVersionLocalId }
  },
  /** Loads an item and keeps it loaded. */
  async loadItem(seedLocalId: string): Promise<void> {
    const item = (await Item.find({ seedLocalId })) as Item<any> | undefined
    if (!item) throw new Error(`no item ${seedLocalId}`)
    loadedItems.set(seedLocalId, item)
  },
  /** A loaded item's property values by name. */
  itemValues(seedLocalId: string): Record<string, unknown> {
    const item = loadedItems.get(seedLocalId)
    if (!item) throw new Error(`item ${seedLocalId} not loaded`)
    return Object.fromEntries(item.properties.map((p) => [p.propertyName, p.value]))
  },
  /** Inserts an attested property row on an existing version, as EAS sync does. */
  async insertSyncedProperty(
    seedLocalId: string,
    versionLocalId: string,
    modelType: string,
    propertyName: string,
    propertyValue: string,
  ): Promise<void> {
    const now = Date.now()
    const hex = () => Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
    await db().insert(metadata).values({
      localId: `tab-meta-${Math.random().toString(36).slice(2, 10)}`,
      uid: `0x${hex()}`,
      seedLocalId,
      versionLocalId,
      modelType,
      propertyName,
      propertyValue,
      easDataType: 'string',
      attestationCreatedAt: now,
      createdAt: now,
    })
  },
  rehydrateCalls: () => rehydrateCalls,
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

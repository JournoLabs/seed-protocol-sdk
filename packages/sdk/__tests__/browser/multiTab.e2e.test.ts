import { afterAll, describe, expect, it, vi } from 'vitest'
import { commands } from 'vitest/browser'
import { getEmbeddedMigrations } from '@/browser/db/embeddedMigrations'
import { WAIT_TIMEOUT_MS } from '../test-utils/timeouts'

/**
 * Two real tabs of one app (Playwright pages in this test's browser context: shared OPFS, Web
 * Locks and BroadcastChannels), each running the SDK client against the same database. The tabs
 * are driven through the `openSeedTab` / `callSeedTab` / `closeSeedTab` commands in vite.config.js.
 * This page only orchestrates; it never inits a client.
 */
type SeedTabCommands = {
  openSeedTab: (url: string) => Promise<string>
  callSeedTab: (id: string, method: string, ...args: unknown[]) => Promise<any>
  closeSeedTab: (id: string) => Promise<void>
}
const tabs = commands as unknown as SeedTabCommands

describe('two tabs of one app', () => {
  const testDir = `multitab-${Math.random().toString(36).slice(2, 8)}`
  const tabUrl = `${location.origin}/packages/sdk/__tests__/e2e/multiTab/tab.html?filesDir=/${testDir}`
  const open: string[] = []

  afterAll(async () => {
    for (const id of open) await tabs.closeSeedTab(id)
    const root = await navigator.storage.getDirectory()
    await root.removeEntry(testDir, { recursive: true }).catch(() => {})
  })

  it('init together, elect one leader, share files, and hand leadership over', async () => {
    const [a, b] = await Promise.all([tabs.openSeedTab(tabUrl), tabs.openSeedTab(tabUrl)])
    open.push(a, b)

    // Both tabs init at once on a fresh database: migrations and init writes take turns.
    await Promise.all([tabs.callSeedTab(a, 'init'), tabs.callSeedTab(b, 'init')])
    expect(await tabs.callSeedTab(a, 'appliedMigrations')).toBe(getEmbeddedMigrations().length)
    expect(await tabs.callSeedTab(b, 'duplicateModelNames')).toEqual([])

    const leaders = [await tabs.callSeedTab(a, 'isLeader'), await tabs.callSeedTab(b, 'isLeader')]
    expect(leaders.filter(Boolean)).toHaveLength(1)
    const [leader, follower] = leaders[0] ? [a, b] : [b, a]

    // A file the leader rewrites behind ZenFS (as a download worker does) reads fresh in the follower.
    const notePath = await tabs.callSeedTab(leader, 'writeOutsideCache', 'files/note.txt', 'v1')
    expect(await tabs.callSeedTab(follower, 'readFile', notePath)).toBe('v1')
    await tabs.callSeedTab(leader, 'writeOutsideCache', 'files/note.txt', 'version two')
    await vi.waitFor(async () => {
      const changed: string[][] = await tabs.callSeedTab(follower, 'filesChanged')
      expect(changed.flat()).toContain(notePath)
    }, { timeout: WAIT_TIMEOUT_MS })
    expect(await tabs.callSeedTab(follower, 'readFile', notePath)).toBe('version two')

    // Saves through the SDK reach the follower's sync API (its in-memory copy) by themselves: the
    // follower only polls readFileSync, which never stats or invalidates.
    const readsSync = (path: string, text: string | null) =>
      vi.waitFor(async () => expect(await tabs.callSeedTab(follower, 'readFileSync', path)).toBe(text), {
        timeout: WAIT_TIMEOUT_MS,
      })
    const leaderId: string = await tabs.callSeedTab(leader, 'tabId')
    const followerId: string = await tabs.callSeedTab(follower, 'tabId')
    // The follower's own init writes are announced too; count from here.
    await new Promise((resolve) => setTimeout(resolve, 200))
    const leaderHeardBefore = (await tabs.callSeedTab(leader, 'filesChangedMessages')).length
    const savedPath = await tabs.callSeedTab(leader, 'saveFile', 'files/saved/doc.txt', 'first')
    await readsSync(savedPath, 'first') // A new file in a directory the follower hadn't cached.
    await tabs.callSeedTab(leader, 'saveFile', 'files/saved/doc.txt', 'a longer second version')
    await readsSync(savedPath, 'a longer second version')
    await tabs.callSeedTab(leader, 'saveFile', 'files/saved/doc.txt', 'third')
    await readsSync(savedPath, 'third') // Shorter: no old tail.
    await tabs.callSeedTab(leader, 'saveFileSync', savedPath, 'written through the sync API')
    await readsSync(savedPath, 'written through the sync API')

    // Bulk saves coalesce into a few messages, and every file still arrives.
    const before = (await tabs.callSeedTab(follower, 'filesChangedMessages')).length
    const bulk: string[] = await tabs.callSeedTab(leader, 'saveFiles', 'files/bulk', 40, 'bulk')
    for (const path of bulk) await readsSync(path, 'bulk')
    const bulkMessages: Array<{ from?: string; paths: string[] }> = (
      await tabs.callSeedTab(follower, 'filesChangedMessages')
    ).slice(before)
    expect(bulkMessages.every((message) => message.from === leaderId)).toBe(true)
    expect(new Set(bulkMessages.flatMap((message) => message.paths))).toEqual(new Set(bulk))
    expect(bulkMessages.length).toBeLessThan(10)

    // Receiving only refreshes caches: the follower never sent a files-changed of its own.
    await new Promise((resolve) => setTimeout(resolve, 200))
    const heardByLeader: Array<{ from?: string; paths: string[] }> = (
      await tabs.callSeedTab(leader, 'filesChangedMessages')
    ).slice(leaderHeardBefore)
    expect(heardByLeader.length).toBeGreaterThan(0) // Its own announcements: the spy works.
    const leaderPaths = new Set([savedPath, ...bulk])
    const echoed = heardByLeader.filter(
      (message) => message.from === followerId && message.paths.some((path) => leaderPaths.has(path)),
    )
    expect(echoed).toEqual([])

    // Closing the leader hands leadership to the other tab.
    await tabs.closeSeedTab(leader)
    open.splice(open.indexOf(leader), 1)
    await vi.waitFor(async () => expect(await tabs.callSeedTab(follower, 'isLeader')).toBe(true), { timeout: WAIT_TIMEOUT_MS })
  }, 120_000)

  it('transactions in both tabs at once neither lose updates nor fail busy', async () => {
    const [a, b] = await Promise.all([tabs.openSeedTab(tabUrl), tabs.openSeedTab(tabUrl)])
    open.push(a, b)
    await Promise.all([tabs.callSeedTab(a, 'init'), tabs.callSeedTab(b, 'init')])

    const key = `tx-counter-${Math.random().toString(36).slice(2, 8)}`
    const times = 25
    await Promise.all([
      tabs.callSeedTab(a, 'incrementInTransactions', key, times),
      tabs.callSeedTab(b, 'incrementInTransactions', key, times),
    ])

    expect(await tabs.callSeedTab(a, 'counterValue', key)).toBe(2 * times)
  }, 60000)

  it("a write in one tab reaches the other tab's change feed", async () => {
    const [a, b] = await Promise.all([tabs.openSeedTab(tabUrl), tabs.openSeedTab(tabUrl)])
    open.push(a, b)
    await Promise.all([tabs.callSeedTab(a, 'init'), tabs.callSeedTab(b, 'init')])

    const localId: string = await tabs.callSeedTab(a, 'insertSeed')
    await tabs.callSeedTab(b, 'watchSeed', localId)
    await tabs.callSeedTab(a, 'touchSeed', localId)
    await vi.waitFor(async () => expect(await tabs.callSeedTab(b, 'changeCalls', localId)).toBe(1), {
      timeout: WAIT_TIMEOUT_MS,
    })

    // And the other way.
    await tabs.callSeedTab(a, 'watchSeed', localId)
    await tabs.callSeedTab(b, 'touchSeed', localId)
    await vi.waitFor(async () => expect(await tabs.callSeedTab(a, 'changeCalls', localId)).toBe(1), {
      timeout: WAIT_TIMEOUT_MS,
    })
  }, 60000)

  it("a synced property row on an existing version reaches the other tab's loaded item", async () => {
    const [a, b] = await Promise.all([tabs.openSeedTab(tabUrl), tabs.openSeedTab(tabUrl)])
    open.push(a, b)
    await Promise.all([tabs.callSeedTab(a, 'init'), tabs.callSeedTab(b, 'init')])

    const schemaName = `Tab Feed Schema ${Math.random().toString(36).slice(2, 8)}`
    const id = () => Math.random().toString(16).slice(2, 12)
    const now = new Date().toISOString()
    const file = {
      $schema: 'https://seedprotocol.org/schemas/data-model/v1',
      version: 1,
      id: id(),
      metadata: { name: schemaName, createdAt: now, updatedAt: now },
      models: {
        TabPost: {
          id: id(),
          properties: { title: { id: id(), type: 'Text' }, summary: { id: id(), type: 'Text' } },
        },
      },
      enums: {},
      migrations: [],
    }
    await tabs.callSeedTab(a, 'importSchema', JSON.stringify(file), file.version)
    await tabs.callSeedTab(b, 'importSchema', JSON.stringify(file), file.version)

    const { seedLocalId, versionLocalId } = await tabs.callSeedTab(a, 'createItem', 'TabPost', schemaName, {
      title: 'first',
    })
    await tabs.callSeedTab(b, 'loadItem', seedLocalId)
    await vi.waitFor(async () => expect(await tabs.callSeedTab(b, 'itemValues', seedLocalId)).toMatchObject({ title: 'first' }), {
      timeout: WAIT_TIMEOUT_MS,
    })

    // What sync writes for a property attested on a version the item already has: a metadata row
    // only. The property isn't in the model, so the item has no instance watching it yet (a model
    // property's instance would see the row through its own watch).
    await tabs.callSeedTab(a, 'insertSyncedProperty', seedLocalId, versionLocalId, 'TabPost', 'subtitle', 'synced')
    await vi.waitFor(
      async () => expect(await tabs.callSeedTab(b, 'itemValues', seedLocalId)).toMatchObject({ subtitle: 'synced' }),
      { timeout: WAIT_TIMEOUT_MS },
    )
    expect(await tabs.callSeedTab(b, 'rehydrateCalls')).toBe(0)
  }, 60000)
})

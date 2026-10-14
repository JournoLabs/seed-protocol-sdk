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
})

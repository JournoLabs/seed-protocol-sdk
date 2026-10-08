import { afterAll, describe, expect, it, vi } from 'vitest'
import { commands } from 'vitest/browser'
import { getEmbeddedMigrations } from '@/browser/db/embeddedMigrations'

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
    })
    expect(await tabs.callSeedTab(follower, 'readFile', notePath)).toBe('version two')

    // Closing the leader hands leadership to the other tab.
    await tabs.closeSeedTab(leader)
    open.splice(open.indexOf(leader), 1)
    await vi.waitFor(async () => expect(await tabs.callSeedTab(follower, 'isLeader')).toBe(true))
  }, 120_000)
})

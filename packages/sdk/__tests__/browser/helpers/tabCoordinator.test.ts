import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isLeaderTab,
  onTabMessage,
  resetTabCoordinationForTests,
  startTabCoordination,
  whenLeaderTab,
} from '@/helpers/tabCoordinator'
import { easSyncActor, requestEasSyncFromAddressChange, requestEasSyncFromModelsInit } from '@/events/item/easSyncManager'
import { otherTab } from '../../test-utils/otherTab'
import { WAIT_TIMEOUT_MS } from '../../test-utils/timeouts'

describe('tab coordination', () => {
  const filesDir = `/tab-coord-${Math.random().toString(36).slice(2, 8)}`
  const dbKey = `${filesDir}/db/seed.db`
  let tab: ReturnType<typeof otherTab> | undefined

  afterEach(async () => {
    vi.restoreAllMocks()
    resetTabCoordinationForTests()
    tab?.worker.terminate()
    tab = undefined
  })

  it('follows while another tab leads, then takes over when it closes', async () => {
    tab = otherTab()
    await tab.send({ type: 'lead', name: `seed:leader:${dbKey}` }, 'leading')

    startTabCoordination({ filesDir })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(isLeaderTab()).toBe(false)

    const tookOver = whenLeaderTab()
    await tab.send({ type: 'step-down' }, 'stepped-down')
    await tookOver
    expect(isLeaderTab()).toBe(true)
  })

  it("defers automatic EAS sync until it leads, and forwards address changes to the leader", async () => {
    const sent = vi.spyOn(easSyncActor, 'send').mockImplementation(() => {})
    tab = otherTab()
    await tab.send({ type: 'lead', name: `seed:leader:${dbKey}` }, 'leading')
    await tab.listen(`seed:tabs:${dbKey}`)
    startTabCoordination({ filesDir })
    await new Promise((resolve) => setTimeout(resolve, 20))

    requestEasSyncFromModelsInit()
    requestEasSyncFromModelsInit()
    requestEasSyncFromAddressChange(['0xabc'])
    await vi.waitFor(
      () => expect(tab!.heard).toEqual([{ type: 'eas-sync-address-change', addresses: ['0xabc'] }]),
      { timeout: WAIT_TIMEOUT_MS },
    )
    expect(sent).not.toHaveBeenCalled()

    const tookOver = whenLeaderTab()
    await tab.send({ type: 'step-down' }, 'stepped-down')
    await tookOver
    await new Promise((resolve) => setTimeout(resolve, 0))
    // The two skipped init requests run once, now that this tab leads.
    expect(sent.mock.calls.map(([event]) => (event as { source: string }).source)).toEqual(['models_init'])
  })

  it('delivers messages from other tabs of the same database', async () => {
    startTabCoordination({ filesDir })
    const received: unknown[] = []
    const unsubscribe = onTabMessage((message) => received.push(message))

    tab = otherTab()
    const message = { type: 'eas-sync-address-change', addresses: ['0xdef'] }
    await tab.send({ type: 'post', channel: `seed:tabs:${dbKey}`, message }, 'posted')
    await vi.waitFor(() => expect(received).toEqual([message]), { timeout: WAIT_TIMEOUT_MS })
    unsubscribe()
  })

  it("acts as leader in every tab with multiTab: 'off'", async () => {
    tab = otherTab()
    await tab.send({ type: 'lead', name: `seed:leader:${dbKey}` }, 'leading')
    startTabCoordination({ filesDir, mode: 'off' })
    expect(isLeaderTab()).toBe(true)
  })
})

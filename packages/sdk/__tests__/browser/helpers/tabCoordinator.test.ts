import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isLeaderTab,
  onTabMessage,
  resetTabCoordinationForTests,
  startTabCoordination,
  whenLeaderTab,
} from '@/helpers/tabCoordinator'
import { easSyncActor, requestEasSyncFromAddressChange, requestEasSyncFromModelsInit } from '@/events/item/easSyncManager'

/**
 * A dedicated worker shares the origin's Web Locks and BroadcastChannels, so it stands in for
 * another tab: it can hold the leader lock and post tab messages.
 */
const OTHER_TAB_SOURCE = `
let release
self.onmessage = (event) => {
  const { type, name, channel, message } = event.data
  if (type === 'lead') {
    navigator.locks.request(name, () => {
      self.postMessage({ type: 'leading' })
      return new Promise((resolve) => (release = resolve))
    })
  }
  if (type === 'step-down') {
    release?.()
    self.postMessage({ type: 'stepped-down' })
  }
  if (type === 'listen') {
    const bc = new BroadcastChannel(channel)
    bc.onmessage = (e) => self.postMessage({ type: 'heard', message: e.data })
    self.postMessage({ type: 'listening' })
  }
  if (type === 'post') {
    new BroadcastChannel(channel).postMessage(message)
    self.postMessage({ type: 'posted' })
  }
}
`

function otherTab() {
  const worker = new Worker(URL.createObjectURL(new Blob([OTHER_TAB_SOURCE], { type: 'text/javascript' })))
  const heard: unknown[] = []
  const send = (data: Record<string, unknown>, reply: string) =>
    new Promise<void>((resolve) => {
      const onMessage = (event: MessageEvent) => {
        if (event.data.type === 'heard') heard.push(event.data.message)
        if (event.data.type === reply) {
          worker.removeEventListener('message', onMessage)
          resolve()
        }
      }
      worker.addEventListener('message', onMessage)
      worker.postMessage(data)
    })
  worker.addEventListener('message', (event) => {
    if (event.data.type === 'heard') heard.push(event.data.message)
  })
  return { worker, send, heard }
}

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
    await tab.send({ type: 'listen', channel: `seed:tabs:${dbKey}` }, 'listening')
    startTabCoordination({ filesDir })
    await new Promise((resolve) => setTimeout(resolve, 20))

    requestEasSyncFromModelsInit()
    requestEasSyncFromModelsInit()
    requestEasSyncFromAddressChange(['0xabc'])
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(sent).not.toHaveBeenCalled()
    expect(tab.heard).toEqual([{ type: 'eas-sync-address-change', addresses: ['0xabc'] }])

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
    onTabMessage((message) => received.push(message))

    tab = otherTab()
    const message = { type: 'eas-sync-address-change', addresses: ['0xdef'] }
    await tab.send({ type: 'post', channel: `seed:tabs:${dbKey}`, message }, 'posted')
    await vi.waitFor(() => expect(received).toEqual([message]))
  })

  it("acts as leader in every tab with multiTab: 'off'", async () => {
    tab = otherTab()
    await tab.send({ type: 'lead', name: `seed:leader:${dbKey}` }, 'leading')
    startTabCoordination({ filesDir, mode: 'off' })
    expect(isLeaderTab()).toBe(true)
  })
})

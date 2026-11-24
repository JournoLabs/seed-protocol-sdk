import { afterEach, describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import { announcePublishLockTaken, onPublishLockTaken } from '@/helpers/publishLockMessages'
import { resetTabCoordinationForTests, startTabCoordination, TAB_ID } from '@/helpers/tabCoordinator'
import { otherTab } from '../../test-utils/otherTab'
import { WAIT_TIMEOUT_MS } from '../../test-utils/timeouts'

/** A tab that takes a seed's publish lock tells the others, which may be waiting to take it over (#48). */
describe('publish lock messages', () => {
  const filesDir = `/publish-lock-${Math.random().toString(36).slice(2, 8)}`
  const channel = `seed:tabs:${filesDir}/db/seed.db`
  let tab: ReturnType<typeof otherTab> | undefined

  afterEach(() => {
    resetTabCoordinationForTests()
    tab?.worker.terminate()
    tab = undefined
  })

  it('tells other tabs which seed this tab took the publish lock of', async () => {
    tab = otherTab()
    await tab.listen(channel)
    startTabCoordination({ filesDir })

    announcePublishLockTaken('seed-1')
    await vi.waitFor(
      () => expect(tab!.heard).toEqual([{ type: 'publish-lock-taken', seedLocalId: 'seed-1', from: TAB_ID }]),
      { timeout: WAIT_TIMEOUT_MS },
    )
  })

  it("hears the seeds other tabs took the publish lock of, and no other messages", async () => {
    startTabCoordination({ filesDir })
    const taken: string[] = []
    const unsubscribe = onPublishLockTaken((seedLocalId) => taken.push(seedLocalId))

    tab = otherTab()
    await tab.send({ type: 'post', channel, message: { type: 'files-changed', paths: ['/x'] } }, 'posted')
    await tab.send({ type: 'post', channel, message: { type: 'publish-lock-taken', seedLocalId: 'seed-2' } }, 'posted')
    await vi.waitFor(() => expect(taken).toEqual(['seed-2']), { timeout: WAIT_TIMEOUT_MS })
    unsubscribe()
  })
})

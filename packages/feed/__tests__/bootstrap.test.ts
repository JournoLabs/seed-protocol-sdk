import { afterEach, describe, expect, it } from 'vitest'
import { BaseEasClient } from '@seedprotocol/eas'
import { initializeFeedPlatform, teardownFeedPlatform } from '../src/bootstrap'

describe('initializeFeedPlatform', () => {
  afterEach(async () => {
    await teardownFeedPlatform()
  })

  it('keeps an EAS client the host registered', async () => {
    const hostGraphQLClient = { request: async () => ({}) }
    BaseEasClient.configure({ getEasClient: () => hostGraphQLClient as never })
    await initializeFeedPlatform()
    expect(BaseEasClient.getEasClient()).toBe(hostGraphQLClient)
  })
})

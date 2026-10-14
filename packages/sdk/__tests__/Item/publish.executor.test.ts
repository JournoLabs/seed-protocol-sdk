import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import {
  setGetPublisherForNewSeeds,
  setPublishExecutor,
  PUBLISH_NOT_CONFIGURED_MESSAGE,
  type ItemPublishOptions,
} from '@/helpers/publishConfig'
import type { IItem } from '@/interfaces/IItem'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import {
  createGetPublishPayloadTestSchema,
  createItemWithBasicPropertiesOnly,
  UNPUBLISH_TEST_PUBLISHER,
} from '../test-utils/getPublishPayloadIntegrationHelpers'

/**
 * item.publish() delegates to the PublishExecutor that @seedprotocol/publish registers.
 * These tests register stand-in executors; the publish package's own executor is tested there.
 */

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

async function createOwnedDraft(title: string) {
  // Owned drafts need a publisher stamped at creation, as the publish package does.
  setGetPublisherForNewSeeds(async () => UNPUBLISH_TEST_PUBLISHER)
  try {
    const { item } = await createItemWithBasicPropertiesOnly({ title })
    return item
  } finally {
    setGetPublisherForNewSeeds(null)
  }
}

testDescribe('Item.publish delegates to the publish executor', () => {
  beforeAll(async () => {
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: SETUP_HOOK_TIMEOUT_MS,
      configOverrides: { addresses: [UNPUBLISH_TEST_PUBLISHER] },
    })
    await createGetPublishPayloadTestSchema()
  }, SETUP_HOOK_TIMEOUT_MS)

  afterEach(() => {
    setPublishExecutor(null)
  })

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('throws, naming @seedprotocol/publish, when no executor is registered', async () => {
    const item = await createOwnedDraft('Publish not configured')
    await expect(item.publish()).rejects.toThrow(PUBLISH_NOT_CONFIGURED_MESSAGE)
    expect(PUBLISH_NOT_CONFIGURED_MESSAGE).toContain('@seedprotocol/publish')
    expect(item.getService().getSnapshot().value).toBe('idle')
  }, 30000)

  it('passes the item and options to the executor and resolves when it finishes', async () => {
    const item = await createOwnedDraft('Publish delegates')
    const calls: { seedLocalId: string; options?: ItemPublishOptions; stateDuringCall: unknown }[] = []
    setPublishExecutor(async (published: IItem<any>, options) => {
      calls.push({
        seedLocalId: published.seedLocalId,
        options,
        stateDuringCall: item.getService().getSnapshot().value,
      })
    })

    await item.publish({ publishMode: 'new_version', arweaveUploadTags: [] })

    expect(calls).toEqual([
      {
        seedLocalId: item.seedLocalId,
        options: { publishMode: 'new_version', arweaveUploadTags: [] },
        stateDuringCall: 'publishing',
      },
    ])
    expect(item.getService().getSnapshot().value).toBe('idle')
    expect(item.getService().getSnapshot().context._publishError).toBeNull()
  }, 30000)

  it('rejects with the executor error and records it on the machine', async () => {
    const item = await createOwnedDraft('Publish fails')
    setPublishExecutor(async () => {
      throw new Error('bundler rejected the upload')
    })

    await expect(item.publish()).rejects.toThrow('bundler rejected the upload')
    const snapshot = item.getService().getSnapshot()
    expect(snapshot.value).toBe('idle')
    expect(snapshot.context._publishError).toEqual({ message: 'bundler rejected the upload' })
  }, 30000)

  it('rejects a second publish while one is in flight', async () => {
    const item = await createOwnedDraft('Publish twice')
    let finish!: () => void
    setPublishExecutor(() => new Promise<void>((resolve) => { finish = resolve }))

    const first = item.publish()
    await expect.poll(() => item.getService().getSnapshot().value).toBe('publishing')
    await expect(item.publish()).rejects.toThrow('Item is already being published.')
    finish()
    await first
  }, 30000)
})

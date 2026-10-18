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

  it('hands the executor the item it was called on, so the executor can set seedUid', async () => {
    // The direct-EAS publish path assigns item.seedUid and then persists it. That assignment threw
    // ("only a getter") when item.publish() passed the raw instance instead of the reactive proxy.
    const item = await createOwnedDraft('Publish sets seedUid')
    const seedUid = '0x' + 'e'.repeat(64)
    let received: IItem<any> | undefined
    setPublishExecutor(async (published: IItem<any>) => {
      received = published
      // A real executor uploads and attests before this; without a wait the assignment would land
      // while the machine is still entering 'publishing', and persistSeedUid would read no uid.
      await new Promise((resolve) => setTimeout(resolve, 0))
      ;(published as { seedUid?: string }).seedUid = seedUid
      await published.persistSeedUid(UNPUBLISH_TEST_PUBLISHER)
    })

    await item.publish()

    expect(received).toBe(item)
    expect(item.seedUid).toBe(seedUid)
    const { BaseDb } = await import('@/db/Db/BaseDb')
    const { seeds } = await import('@/seedSchema')
    const { eq } = await import('drizzle-orm')
    const [row] = await BaseDb.getAppDb().select().from(seeds).where(eq(seeds.localId, item.seedLocalId))
    expect(row?.uid?.toLowerCase()).toBe(seedUid)
  }, 30000)

  it('rejects with the executor error and records it on the machine', async () => {
    const item = await createOwnedDraft('Publish fails')
    setPublishExecutor(async () => {
      throw new Error('bundler rejected the upload')
    })

    await expect(item.publish()).rejects.toThrow('bundler rejected the upload')
    const snapshot = item.getService().getSnapshot()
    expect(snapshot.value).toBe('idle')
    expect(snapshot.context._publishError?.message).toBe('bundler rejected the upload')
  }, 30000)

  it('rejects with the executor error itself, keeping its class, code and cause', async () => {
    // Stands in for @seedprotocol/publish's ManagedAccountPublishError, which apps branch on by code.
    class ExecutorError extends Error {
      constructor(message: string, readonly code: string, options?: { cause?: unknown }) {
        super(message, options)
        this.name = 'ExecutorError'
      }
    }
    const item = await createOwnedDraft('Publish fails with a code')
    const cause = new Error('rpc timeout')
    const thrown = new ExecutorError('managed account unavailable', 'MANAGED_ACCOUNT_UNAVAILABLE', { cause })
    setPublishExecutor(async () => {
      throw thrown
    })

    const error = await item.publish().catch((e: unknown) => e)
    expect(error).toBe(thrown)
    expect(error).toBeInstanceOf(ExecutorError)
    expect((error as ExecutorError).code).toBe('MANAGED_ACCOUNT_UNAVAILABLE')
    expect((error as Error).cause).toBe(cause)
    expect(item.getService().getSnapshot().context._publishError).toBe(thrown)
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

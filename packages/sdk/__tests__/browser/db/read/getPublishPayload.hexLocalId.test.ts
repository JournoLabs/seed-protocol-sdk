import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { getPublishPayload } from '@/db/read/getPublishPayload'
import { Item } from '@/Item/Item'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../../../test-utils/client-init'
import {
  createGetPublishPayloadTestSchema,
  createItemWithList,
  createItemWithRelation,
  waitForPropertyInstances,
} from '../../../test-utils/getPublishPayloadIntegrationHelpers'

// Local ids are 10 random alphanumerics, so ~1 in 3,844 starts with "0x" (CI run 38092037319 drew
// "0xYVM3w1mf"). Such an id is still a local id, not an EAS uid.
const hexIds = vi.hoisted(() => ({ on: false, count: 0 }))
vi.mock('@/helpers/generateId', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/helpers/generateId')>()
  return {
    generateId: () => {
      const id = actual.generateId()
      if (!hexIds.on) return id
      hexIds.count++
      return '0x' + id.slice(2)
    },
  }
})

describe('getPublishPayload with local ids that start with 0x', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    await createGetPublishPayloadTestSchema()
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('encodes list members whose local id starts with 0x', async () => {
    hexIds.on = true
    let tags: Item<any>[]
    let post: Item<any>
    try {
      const created = await createItemWithList({ tagLabels: ['hex1', 'hex2'], postTitle: 'Post with 0x tags' })
      tags = created.tagItems
      post = created.postItem
    } finally {
      hexIds.on = false
    }
    expect(hexIds.count).toBeGreaterThan(0)
    expect(tags.every((t) => t.seedLocalId!.startsWith('0x'))).toBe(true)
    await waitForPropertyInstances(post)

    const result = await getPublishPayload(post, [])
    const mainPayload = result.find((p) => p.localId === post.seedLocalId)
    expect(mainPayload).toBeDefined()
  }, 30000)

  it('resolves a relation to an unpublished item whose local id starts with 0x', async () => {
    hexIds.on = true
    let author: Item<any>
    let post: Item<any>
    try {
      const created = await createItemWithRelation({ authorName: 'Hex Author', postTitle: 'Post with 0x author' })
      author = created.authorItem
      post = created.postItem
    } finally {
      hexIds.on = false
    }
    expect(author.seedLocalId!.startsWith('0x')).toBe(true)

    const result = await getPublishPayload(post, [])
    const mainPayload = result.find((p) => p.localId === post.seedLocalId)
    expect(mainPayload).toBeDefined()
    // The author publishes first and its uid is filled in afterwards, as for any local id
    const authorAttestation = mainPayload!.listOfAttestations.find((a: any) => a._propertyName === 'author')
    expect(authorAttestation?._unresolvedValue).toBe(author.seedLocalId)
  }, 30000)
})

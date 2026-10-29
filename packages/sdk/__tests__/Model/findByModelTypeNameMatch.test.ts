// @vitest-environment node
/**
 * Model.findByModelType reads the nameMatch levels (ADR 0009) synchronously. They used to load a
 * few seconds after init, so right after init a model set to 'exact' still matched fuzzily, and
 * every schema write reopened that window.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Model } from '@/Model/Model'
import { clearNameMatchLevels } from '@/db/read/nameMatchLevels'
import { generateId } from '@/helpers'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

const testDescribe = typeof window === 'undefined' ? describe.sequential : describe.skip

const schema = {
  $schema: 'https://seedprotocol.io/schemas/data-model/v1',
  version: 1,
  id: 'find-by-model-type-name-match',
  metadata: { name: 'Find By Model Type NameMatch', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  models: {
    NmPost: { id: generateId(), nameMatch: 'exact', properties: { title: { id: generateId(), type: 'Text' } } },
    NmArticle: { id: generateId(), properties: { title: { id: generateId(), type: 'Text' } } },
  },
  enums: {},
  migrations: [],
}

const lookups = () => ({
  exactPlural: Model.findByModelType('nm_posts')?.modelName,
  exact: Model.findByModelType('nm_post')?.modelName,
  fuzzyPlural: Model.findByModelType('nm_articles')?.modelName,
})

testDescribe('Model.findByModelType and nameMatch levels', () => {
  let atReady: ReturnType<typeof lookups> | undefined

  beforeAll(async () => {
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: SETUP_HOOK_TIMEOUT_MS,
      configOverrides: { config: { schema } } as never,
      beforeInit: async () => {
        const { client } = await import('@/client')
        // Look the types up in the same tick init reports ready.
        const subscription = client.getService().subscribe((snapshot) => {
          if (snapshot.value !== 'idle' || atReady) return
          atReady = lookups()
          subscription.unsubscribe()
        })
      },
    })
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it("uses the configured levels as soon as init is ready: an 'exact' model doesn't fuzzy-match", () => {
    expect(atReady).toEqual({ exactPlural: undefined, exact: 'NmPost', fuzzyPlural: 'NmArticle' })
  })

  it('keeps the levels it had while the reload after a schema write runs', async () => {
    clearNameMatchLevels()
    expect(lookups()).toEqual({ exactPlural: undefined, exact: 'NmPost', fuzzyPlural: 'NmArticle' })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(lookups()).toEqual({ exactPlural: undefined, exact: 'NmPost', fuzzyPlural: 'NmArticle' })
  })
})

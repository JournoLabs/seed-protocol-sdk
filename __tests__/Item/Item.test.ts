import { beforeEach, describe, it, vi } from 'vitest'
import { getPosts } from '../__fixtures__/posts'

// Mock the client to avoid real initialization
vi.mock('@/client', () => ({
  client: {
    init: vi.fn().mockResolvedValue(undefined),
    isInitialized: vi.fn().mockReturnValue(true),
  },
}))

// Mock the config - projects no longer need to provide models in config
// Models are now defined in schema files, so config can be empty
vi.mock('@/test/__mocks__/node/project/seed.config', () => ({
  default: {
    models: {},
    endpoints: {
      localOutputDir: './seed-files'
    }
  }
}), { virtual: true })

describe('Item', () => {
  beforeEach(async () => {
    // Clear mocks before each test
    vi.clearAllMocks()
  })

  it('should create items', async ({ expect }) => {
    const posts = await getPosts(3)
    expect(posts).toHaveLength(3)
    
    // Verify each post has the expected structure
    posts.forEach(post => {
      expect(post).toHaveProperty('title')
      expect(post).toHaveProperty('summary')
      expect(post).toHaveProperty('html')
      expect(post).toHaveProperty('json')
      expect(post).toHaveProperty('storageTransactionId')
    })
  })
})

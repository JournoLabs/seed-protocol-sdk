import { beforeEach, describe, it } from 'vitest'
import { getPosts }                 from '../__fixtures__/posts'
import { client as seedClient } from '@/client'
import config                   from '@/test/__mocks__/node/project/schema'

describe('Item', () => {

  beforeEach(async () => {
    await seedClient.init({
      config,
      addresses: [
        '0x1234567890123456789012345678901234567890',
      ],
    })
  })

  it('should create items', async ( { expect } ) => {
    const posts = await getPosts(3)
    expect(posts).toHaveLength(3)
  })
})

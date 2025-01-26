import { models }        from '../__mocks__/project/schema'
import { BaseItem }      from '@/Item/BaseItem'
import { getIdentities } from './identities'

const { Post } = models

export const getPosts = async ( numPosts: number ): Promise<BaseItem<any>[]> => {
  const posts: BaseItem<any>[] = []

  const identities = await getIdentities(numPosts)

  for ( let i = 0; i < numPosts; i++ ) {
    const authors = [ identities[i] ]
    const post    = await BaseItem.create({
      modelName: 'Post',
      title: `Post ${i}`,
      summary: `Summary for post ${i}`,
      featuredImage: `https://picsum.photos/200/300?random=${i}`,
      authors,
      html: `<h1>HTML for post ${i}</h1>`,
      json: `{"json": "for post ${i}"}`,
    })
    posts.push(post)
  }
  return posts
}

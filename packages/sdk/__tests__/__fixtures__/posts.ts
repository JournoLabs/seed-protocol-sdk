import { Item } from '@/Item/Item'
import { getIdentities } from './identities'


export const getPosts = async ( numPosts: number ): Promise<Item<any>[]> => {
  const posts: Item<any>[] = []

  const identities = await getIdentities(numPosts)

  for ( let i = 0; i < numPosts; i++ ) {
    const authors = [ identities[i] ]
    const post    = await Item.create({
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

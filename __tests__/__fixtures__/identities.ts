import { Item } from '@/Item/Item'


export const getIdentities = async ( numIdentities: number ): Promise<Item<any>[]> => {
  const identities: Item<any>[] = []
  for ( let i = 0; i < numIdentities; i++ ) {
    const identity = await Item.create({
      modelName: 'Identity',
      name: `Identity ${i}`,
      profile: `Profile for identity ${i}`,
      coverImage: `https://picsum.photos/200/300?random=${i}`,
      avatarImage: `https://picsum.photos/200/300?random=${i + 1}`,
    })
    identities.push(identity)
  }
  return identities
}

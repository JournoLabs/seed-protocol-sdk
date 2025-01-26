import { BaseItem } from '@/Item/BaseItem'
import { models }   from '../__mocks__/project/schema'

const { Identity } = models

export const getIdentities = async ( numIdentities: number ): Promise<BaseItem<any>[]> => {
  const identities: BaseItem<any>[] = []
  for ( let i = 0; i < numIdentities; i++ ) {
    const identity = await Identity.create({
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
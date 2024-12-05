import { EventObject, fromCallback } from 'xstate'
import { createSeed } from '@/browser/db/write'
import { FromCallbackInput, ItemMachineContext } from '@/types'
import { createVersion } from '@/browser/db/write/createVersion'

export const hydrateNewItem = fromCallback<
  EventObject,
  FromCallbackInput<ItemMachineContext<any>>
>(({ sendBack, input: { context } }) => {
  const { seedUid, versionUid, modelName } = context

  let newSeedLocalId: string

  const _hydrateNewItem = async (): Promise<void> => {
    if (!modelName) {
      throw new Error('modelName is required')
    }

    newSeedLocalId = await createSeed({
      type: modelName.toLowerCase(),
      seedUid: seedUid ?? 'NULL',
    })

    await createVersion({
      seedLocalId: newSeedLocalId,
      seedType: modelName.toLowerCase(),
      uid: versionUid ?? 'NULL',
    })
  }

  _hydrateNewItem().then(() => {
    sendBack({ type: 'hydrateNewItemSuccess' })
  })
})

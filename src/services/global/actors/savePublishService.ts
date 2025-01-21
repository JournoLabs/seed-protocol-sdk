import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput, GlobalMachineContext } from '@/types/machines'
import { saveAppState } from '@/db/write/saveAppState'

export const savePublishService = fromCallback<
  EventObject,
  FromCallbackInput<GlobalMachineContext>
>(({ sendBack, input: { event, context } }) => {
  const { publishItemService } = context

  if (!publishItemService) {
    sendBack({ type: 'savePublishServiceError' })
    return
  }

  const _savePublishService = async (): Promise<boolean> => {
    await saveAppState(
      `snapshot__publishItemService`,
      JSON.stringify(publishItemService.getPersistedSnapshot()),
    )

    return true
  }

  _savePublishService().then((success) => {
    if (success) {
      sendBack({ type: 'savePublishServiceSuccess' })
    }
  })
})

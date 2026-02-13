import { FromCallbackInput } from "~/types/machines";
import { PublishMachineContext } from "~/types/types";
import { EventObject, fromCallback } from "xstate";
import { itemNeedsArweaveUpload } from "../helpers/itemNeedsArweave";

const activePublishProcesses = new Set<string>()

export const checking = fromCallback<
  EventObject, 
  FromCallbackInput<PublishMachineContext>
>(( {sendBack, input: {context, }, }, ) => {
  const { item, } = context

  const _check = async () => {
    if (activePublishProcesses.has(item.seedLocalId)) {
      sendBack({
        type : 'redundantPublishProcess',
      },)
      return
    }

    activePublishProcesses.add(item.seedLocalId)

    try {
      const needsArweave = await itemNeedsArweaveUpload(item)
      if (needsArweave) {
        sendBack({ type: 'validPublishProcess' })
      } else {
        sendBack({ type: 'skipArweave' })
      }
    } catch (err) {
      activePublishProcesses.delete(item.seedLocalId)
      console.error('[checking] itemNeedsArweaveUpload failed', err)
      sendBack({ type: 'skipArweave' })
    }
  }

  _check().catch(() => {
    activePublishProcesses.delete(item.seedLocalId)
    sendBack({ type: 'validPublishProcess' })
  })

  return () => {
    activePublishProcesses.delete(item.seedLocalId)
  }
})

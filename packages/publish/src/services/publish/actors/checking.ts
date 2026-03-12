import type { PublishMachineContext } from '../../../types'

type FromCallbackInput<T> = { context: T; event?: unknown }
import { EventObject, fromCallback } from "xstate";
import { itemNeedsArweaveUpload } from "../helpers/itemNeedsArweave";
import { isItemOwned, validateItemForPublish } from '@seedprotocol/sdk'

const activePublishProcesses = new Set<string>()

export const checking = fromCallback<
  EventObject, 
  FromCallbackInput<PublishMachineContext>
>(( {sendBack, input: {context, }, }, ) => {
  const { item } = context

  const _check = async () => {
    // Ownership: use isItemOwned so we align with EAS sync (includes getAdditionalSyncAddresses
    // e.g. modular executor contract). Items attested by the executor are considered owned.
    const owned = await isItemOwned(item)
    if (!owned) {
      sendBack({ type: 'notOwner' })
      return
    }

    if (activePublishProcesses.has(item.seedLocalId)) {
      sendBack({
        type : 'redundantPublishProcess',
      },)
      return
    }

    activePublishProcesses.add(item.seedLocalId)

    try {
      // Validate item before any Arweave or EAS work (pass empty array - no uploads yet)
      const validation = await validateItemForPublish(item, [])
      if (!validation.isValid) {
        activePublishProcesses.delete(item.seedLocalId)
        sendBack({ type: 'validationFailed', errors: validation.errors })
        return
      }

      const needsArweave = await itemNeedsArweaveUpload(item)
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/2810478a-7cf0-49a8-bc23-760b81417972',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'356af5'},body:JSON.stringify({sessionId:'356af5',location:'checking.ts:needsArweave',message:'checking result',data:{needsArweave,outcome:needsArweave?'validPublishProcess':'skipArweave',seedLocalId:item.seedLocalId},timestamp:Date.now(),hypothesisId:'H5'})}).catch(()=>{});
      // #endregion
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

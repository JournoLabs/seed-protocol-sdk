import type { PublishMachineContext } from '../../../types'

type FromCallbackInput<T> = { context: T; event?: unknown }
import { EventObject, fromCallback } from "xstate";
import { optimismSepolia } from 'thirdweb/chains'
import { getClient } from '~/helpers/thirdweb'
import { itemNeedsArweaveUpload } from "../helpers/itemNeedsArweave";
import { ensureEasSchemasForItem } from '../helpers/ensureEasSchemas'
import { isItemOwned, validateItemForPublish } from '@seedprotocol/sdk'
import { getPublishConfig } from '~/config'

const activePublishProcesses = new Set<string>()

export const checking = fromCallback<
  EventObject, 
  FromCallbackInput<PublishMachineContext>
>(( {sendBack, input: {context, }, }, ) => {
  const { item, account, publishMode } = context

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
      // Ensure EAS schemas exist (register if missing) before validation. getPublishPayload
      // requires schema UIDs; without this, new models like "Signal" fail validation.
      if (account) {
        await ensureEasSchemasForItem(item, account, getClient(), optimismSepolia)
      }

      // Validate item before any Arweave or EAS work (pass empty array - no uploads yet)
      const validation = await (validateItemForPublish as any)(item, [], {
        publishMode: publishMode ?? 'patch',
      })
      if (!validation.isValid) {
        activePublishProcesses.delete(item.seedLocalId)
        sendBack({ type: 'validationFailed', errors: validation.errors })
        return
      }

      const needsArweave = await itemNeedsArweaveUpload(item)
      if (needsArweave) {
        const useBundler = getPublishConfig().useArweaveBundler
        sendBack({ type: useBundler ? 'validPublishProcessBundler' : 'validPublishProcess' })
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

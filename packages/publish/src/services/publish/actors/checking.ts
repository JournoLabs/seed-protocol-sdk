import type { PublishMachineContext } from '../../../types'

type FromCallbackInput<T> = { context: T; event?: unknown }
import { EventObject, fromCallback } from 'xstate'
import { optimismSepolia } from 'thirdweb/chains'
import { getClient, isSmartWalletDeployed } from '~/helpers/thirdweb'
import { itemNeedsArweaveUpload } from '../helpers/itemNeedsArweave'
import { ensureEasSchemasForItem } from '../helpers/ensureEasSchemas'
import { isItemOwned, validateItemForPublish } from '@seedprotocol/sdk'
import { getPublishConfig } from '~/config'

const activePublishProcesses = new Set<string>()

async function resolveAttestationStrategy(publisherAddress: string): Promise<'multiPublish' | 'directEas'> {
  const cfg = getPublishConfig()
  if (cfg.useDirectEas) return 'directEas'
  if (cfg.useModularExecutor) return 'multiPublish'
  const deployed = await isSmartWalletDeployed(publisherAddress)
  return deployed ? 'multiPublish' : 'directEas'
}

export const checking = fromCallback<EventObject, FromCallbackInput<PublishMachineContext>>(
  ({ sendBack, input: { context } }) => {
    const { item, account, publishMode, address } = context

    const _check = async () => {
      const owned = await isItemOwned(item)
      if (!owned) {
        sendBack({ type: 'notOwner' })
        return
      }

      if (activePublishProcesses.has(item.seedLocalId)) {
        sendBack({
          type: 'redundantPublishProcess',
        })
        return
      }

      activePublishProcesses.add(item.seedLocalId)

      try {
        if (account) {
          await ensureEasSchemasForItem(item, account, getClient(), optimismSepolia)
        }

        const validation = await (validateItemForPublish as any)(item, [], {
          publishMode: publishMode ?? 'patch',
        })
        if (!validation.isValid) {
          activePublishProcesses.delete(item.seedLocalId)
          sendBack({ type: 'validationFailed', errors: validation.errors })
          return
        }

        if (!address || typeof address !== 'string' || !address.trim()) {
          activePublishProcesses.delete(item.seedLocalId)
          sendBack({
            type: 'validationFailed',
            errors: [{ message: 'No publisher address for publish. Connect a wallet and try again.' }],
          })
          return
        }

        let attestationStrategy: 'multiPublish' | 'directEas'
        try {
          attestationStrategy = await resolveAttestationStrategy(address.trim())
        } catch (cause) {
          activePublishProcesses.delete(item.seedLocalId)
          sendBack({
            type: 'checkingFailed',
            error: new Error(
              'Could not verify whether the publisher is a deployed contract on Optimism Sepolia. Check your RPC connection and retry.',
              { cause },
            ),
          })
          return
        }

        const needsArweave = await itemNeedsArweaveUpload(item)
        const useBundler = getPublishConfig().useArweaveBundler
        const payload = { attestationStrategy } as const
        if (needsArweave) {
          if (useBundler) {
            sendBack({ type: 'validPublishProcessBundler', ...payload })
          } else {
            sendBack({ type: 'validPublishProcess', ...payload })
          }
        } else {
          sendBack({ type: 'skipArweave', ...payload })
        }
      } catch (err) {
        activePublishProcesses.delete(item.seedLocalId)
        console.error('[checking] failed', err)
        sendBack({
          type: 'checkingFailed',
          error: err instanceof Error ? err : new Error(String(err)),
        })
      }
    }

    _check().catch((err) => {
      activePublishProcesses.delete(item.seedLocalId)
      console.error('[checking] unhandled rejection', err)
      sendBack({
        type: 'checkingFailed',
        error: err instanceof Error ? err : new Error(String(err)),
      })
    })

    return () => {
      activePublishProcesses.delete(item.seedLocalId)
    }
  },
)

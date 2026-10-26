import type { PublishMachineContext } from '../../../types'

type FromCallbackInput<T> = { context: T; event?: unknown }
import { EventObject, fromCallback } from 'xstate'
import { getAccountCodeKind, readUntil } from '~/helpers/chainClient'
import { getPublishWallet } from '~/helpers/publishWalletRegistry'
import { itemNeedsArweaveUpload } from '../helpers/itemNeedsArweave'
import { ensureEasSchemasForItem } from '../helpers/ensureEasSchemas'
import {
  assertLocalDbChain,
  getUnpublishedRelatedItems,
  isItemOwned,
  RelatedItemUnpublishedError,
  validateItemForPublish,
} from '@seedprotocol/sdk'
import { getPublishConfig } from '~/config'
import { getPublishChainName } from '../../../helpers/chainConfig'
import { verifyPublishChain } from '../../../helpers/verifyPublishChain'
import { ManagedAccountPublishError } from '../../../errors'

const activePublishProcesses = new Set<string>()

async function resolveAttestationStrategy(publisherAddress: string): Promise<'multiPublish' | 'directEas'> {
  const cfg = getPublishConfig()
  if (cfg.useDirectEas) return 'directEas'
  if (cfg.useModularExecutor) return 'multiPublish'
  // An EIP-7702 delegated EOA has code, but it is an EOA with no Seed extension: it attests
  // directly, like an EOA with no code.
  const kind = await getAccountCodeKind(publisherAddress)
  return kind === 'contract' ? 'multiPublish' : 'directEas'
}

/**
 * Direct EAS is for EOAs (and `useDirectEas`). A publisher with no bytecode is attested straight
 * to EAS only when the wallet says it is an EOA and signs as the publisher; an undeployed smart
 * account, an unknown wallet, or a wallet that sends as someone else is refused.
 */
function directEasRefusal(
  problem: import('../helpers/undeployedSmartAccount').DirectEasProblem | null,
  publisherAddress: string,
  wallet: Partial<import('~/helpers/seedSigner').PublishWallet> | undefined,
): Error | null {
  const chain = getPublishChainName()
  switch (problem) {
    case null:
      return null
    case 'smart_account':
      return new ManagedAccountPublishError(
        `The publishing smart account ${publisherAddress} is not deployed on ${chain} yet. Deploy it first (your wallet's setup flow, or deploySmartWalletContract from @seedprotocol/publish/thirdweb), then publish again.`,
        'MANAGED_ACCOUNT_NOT_DEPLOYED',
        publisherAddress,
      )
    case 'sender_is_not_publisher':
      return new Error(
        `The publish wallet sends as ${wallet?.txSender?.address}, not as the publisher ${publisherAddress}, which has no contract deployed on ${chain}. Attesting directly to EAS would record the wrong attester. Connect the publisher's wallet, or deploy the publisher's smart account first.`,
      )
    case 'signer_is_not_publisher':
      return new Error(
        `The publish wallet signs as ${wallet?.signer?.address}, not as the publisher ${publisherAddress}. Attesting directly to EAS would record the wrong attester.`,
      )
    case 'unknown_wallet_kind':
      return new Error(
        `The publisher ${publisherAddress} has no contract on ${chain}, and the publish wallet doesn't say whether it is an EOA or an undeployed smart account. Build it with fromEip1193Provider or fromEthersWallet, set kind: 'eoa' on the PublishWallet, or set useDirectEas to attest directly anyway.`,
      )
  }
}

/** The registered session's deploy, when it publishes as this address. */
function deployerFor(publisherAddress: string): (() => Promise<void>) | undefined {
  const session = getPublishWallet()
  const sessionPublisher = session?.publisherAddress ?? session?.txSender.address
  if (!session?.deploy || !sessionPublisher) return undefined
  return sessionPublisher.toLowerCase() === publisherAddress.toLowerCase() ? session.deploy : undefined
}

export const checking = fromCallback<EventObject, FromCallbackInput<PublishMachineContext>>(
  ({ sendBack, input: { context } }) => {
    const { item, account, wallet, publishMode, address } = context

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
        // The local DB must hold data from the chain we are about to attest on.
        await assertLocalDbChain()
        // RPC chain id and contract deployments; cached after the first success.
        await verifyPublishChain()

        // References to unpublished (revoked) items fail the publish before schemas are
        // registered or anything is uploaded; validateItemForPublish below reports the same.
        const unpublishedRelatedItems = await getUnpublishedRelatedItems(item, {
          publishMode: publishMode ?? 'patch',
        })
        if (unpublishedRelatedItems.length > 0) {
          activePublishProcesses.delete(item.seedLocalId)
          sendBack({
            type: 'validationFailed',
            errors: new RelatedItemUnpublishedError(unpublishedRelatedItems).validationErrors,
          })
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

        // ADR 0021: retracted properties are revoked after attesting, from the attester. Fail now,
        // before anything is attested and before EAS schemas are registered (which costs
        // transactions), when this wallet can't revoke.
        if (item.seedUid) {
          const { getPendingRetractions } = await import('@seedprotocol/sdk')
          const retractions = await getPendingRetractions({ seedLocalId: item.seedLocalId, seedUid: item.seedUid })
          if (retractions.length > 0) {
            const { assertCanRevokeSeedAttestations } = await import('../../revoke/revokeAttestations')
            await assertCanRevokeSeedAttestations({ seedLocalId: item.seedLocalId, seedUid: item.seedUid })
          }
        }

        const publishWallet = wallet ?? account
        if (publishWallet) {
          await ensureEasSchemasForItem(
            item,
            publishWallet as import('~/helpers/seedSigner').PublishWallet,
            { managedAddress: typeof address === 'string' ? address : undefined },
          )
        }

        const validation = await (validateItemForPublish as any)(item, [], {
          publishMode: publishMode ?? 'patch',
        })
        if (!validation.isValid) {
          activePublishProcesses.delete(item.seedLocalId)
          sendBack({ type: 'validationFailed', errors: validation.errors })
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
              `Could not verify whether the publisher is a deployed contract on ${getPublishChainName()}. Check your RPC connection and retry.`,
              { cause },
            ),
          })
          return
        }

        if (attestationStrategy === 'directEas' && !getPublishConfig().useDirectEas) {
          const publishWallet = (wallet ?? account) as
            | Partial<import('~/helpers/seedSigner').PublishWallet>
            | undefined
          const { directEasProblem } = await import('../helpers/undeployedSmartAccount')
          let problem = directEasProblem(address.trim(), publishWallet)
          // An undeployed smart account: deploy it (one transaction), then publish through it.
          if (problem === 'smart_account') {
            const deploy = deployerFor(address.trim())
            if (deploy) {
              await deploy()
              // Read again until the RPC has the deploy's block (load-balanced nodes lag).
              const codeKind = await readUntil(
                () => getAccountCodeKind(address.trim()),
                (kind) => kind === 'contract',
              )
              if (codeKind === 'contract') {
                attestationStrategy = 'multiPublish'
                problem = null
              }
            }
          }
          const refusal = attestationStrategy === 'directEas' ? directEasRefusal(problem, address.trim(), publishWallet) : null
          if (refusal) {
            activePublishProcesses.delete(item.seedLocalId)
            sendBack({ type: 'checkingFailed', error: refusal })
            return
          }
        }

        const needsArweave = await itemNeedsArweaveUpload(item)
        const payload = { attestationStrategy } as const
        if (needsArweave) {
          sendBack({ type: 'validPublishProcess', ...payload })
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

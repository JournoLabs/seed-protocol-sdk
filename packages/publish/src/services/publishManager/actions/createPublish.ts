import type { Item } from '@seedprotocol/sdk'
import { enqueueActions, type AnyActorRef } from 'xstate'
import { getPublishConfig } from '~/config'
import {
  isPublishWallet,
  isSeedSigner,
  type PublishWallet,
  type SeedSigner,
} from '~/helpers/seedSigner'
import { ethers } from 'ethers'
import { publishMachine } from '../../publish'
import { subscribe } from '../actors/subscribe'
import { dataItemSignerForPublish, getPublishWallet } from '~/helpers/publishWalletRegistry'
import { settleCreatePublish } from '../createPublishResult'
import { holdItemUntilStopped } from '../holdPublishItem'
import { markInProgressPublishInterrupted } from '../actors/savePublish'
import { stopScopedOrStandaloneChild } from './stopScopedOrStandaloneChild'
import { isParkedRun } from '../parkedRun'
import type { ReplaceParked } from '..'

function coerceWallet(account: unknown): PublishWallet | undefined {
  if (!account) return undefined
  if (isPublishWallet(account)) return account
  // Legacy: SeedSigner alone cannot send — try registry wallet
  if (isSeedSigner(account)) {
    const registered = getPublishWallet()
    if (registered && registered.signer.address.toLowerCase() === account.address.toLowerCase()) {
      return registered
    }
    throw new Error(
      '@seedprotocol/publish: createPublish requires a PublishWallet (signer + txSender). Use fromEthersWallet, fromEip1193Provider, or fromThirdwebAccount.',
    )
  }
  throw new Error(
    '@seedprotocol/publish: createPublish account must be a PublishWallet. Thirdweb Account must be wrapped with fromThirdwebAccount from @seedprotocol/publish/thirdweb.',
  )
}

function coerceDataItemSigner(
  signer: import('~/config').CreatePublishOptions['dataItemSigner'],
): SeedSigner | ethers.Wallet | undefined {
  if (!signer) return undefined
  if (signer instanceof ethers.Wallet) return signer
  if (isPublishWallet(signer)) return signer.signer
  if (isSeedSigner(signer)) return signer
  return undefined
}

export const createPublish = enqueueActions(({ context: managerContext, event, enqueue, self }) => {
  const ev = event as unknown as {
    item: Item<any>
    address?: string
    account?: unknown
    options?: import('~/config').CreatePublishOptions
    createToken?: number
    replaceParked?: ReplaceParked
  }
  const { item, address, account, options, createToken, replaceParked } = ev

  const hasAddress = address != null && typeof address === 'string' && address.trim().length > 0
  if (!hasAddress) {
    console.warn('[createPublish] No valid wallet address; skipping spawn.')
    settleCreatePublish(createToken, undefined)
    return
  }

  // A run parked after a failed attestation is ended as stopPublish ends it, keeping the lock this
  // publish holds, and the new run takes over from it (ADR 0036). It's checked again here: a retry
  // since PublishManager.createPublish looked may be sending, and then nothing is replaced.
  const existing = managerContext.publishProcesses.get(item.seedLocalId)
  const parked = replaceParked && isParkedRun(existing) ? existing : undefined
  if (parked) {
    void markInProgressPublishInterrupted(item.seedLocalId).catch((error) => {
      console.warn(`[createPublish] Failed to mark the parked publish of "${item.seedLocalId}" interrupted:`, error)
    })
    stopScopedOrStandaloneChild(self, parked as AnyActorRef, enqueue)
    const parkedSubscription = managerContext.subscriptions.get(item.seedLocalId)
    if (parkedSubscription) stopScopedOrStandaloneChild(self, parkedSubscription as AnyActorRef, enqueue)
    enqueue.assign(({ context }) => {
      const publishProcesses = new Map(context.publishProcesses)
      publishProcesses.delete(item.seedLocalId)
      const subscriptions = new Map(context.subscriptions)
      subscriptions.delete(item.seedLocalId)
      return { ...context, publishProcesses, subscriptions }
    })
  }
  const nonceKey = options?.nonceKey ?? (parked ? replaceParked?.nonceKey : undefined)

  enqueue.assign(({ context, spawn }) => {
    const { publishProcesses } = context
    if (publishProcesses && publishProcesses.has(item.seedLocalId)) {
      console.warn(`Publish process with seedLocalId "${item.seedLocalId}" already exists.`)
      settleCreatePublish(createToken, undefined)
      return context
    }
    const publishRunId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `run_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`

    const publishCfg = getPublishConfig()
    const arweaveUploadTags = [
      ...(publishCfg.arweaveUploadTags ?? []),
      ...(options?.arweaveUploadTags ?? []),
    ]

    const wallet = coerceWallet(account) ?? getPublishWallet() ?? undefined

    const publishProcess = spawn(publishMachine, {
      input: {
        item,
        address: address as string,
        wallet,
        account: wallet,
        modelName: item.modelName,
        schemaId: item.schemaUid,
        signDataItems: options?.signDataItems,
        // A caller's signer, else the config's, else the wallet's EOA (A4): every entry point
        // signs data items the same way.
        dataItemSigner:
          coerceDataItemSigner(options?.dataItemSigner) ??
          coerceDataItemSigner(publishCfg.dataItemSigner) ??
          dataItemSignerForPublish(wallet, address as string),
        publishMode: options?.publishMode ?? 'patch',
        publishRunId,
        arweaveUploadTags: arweaveUploadTags.length ? arweaveUploadTags : undefined,
        htmlEmbeddedDataUriPolicy:
          options?.htmlEmbeddedDataUriPolicy ??
          publishCfg.htmlEmbeddedDataUriPolicy ??
          'materialize',
        htmlArweaveRefs: options?.htmlArweaveRefs ?? publishCfg.htmlArweaveRefs ?? 'gateway',
        onPublished: options?.onPublished ?? publishCfg.onPublished,
        authorizePublish: options?.authorizePublish ?? publishCfg.authorizePublish,
        uploadLimits: {
          maxUploadBytes: options?.maxUploadBytes ?? publishCfg.maxUploadBytes,
          confirmUploadAboveBytes: publishCfg.confirmUploadAboveBytes,
          uplinkBitsPerSecond: publishCfg.uplinkBitsPerSecond,
        },
        confirmUpload: options?.confirmUpload === true,
        ...(nonceKey !== undefined && { nonceKey }),
        ...(options?.licenseOffer !== undefined && { licenseOffer: options.licenseOffer }),
        ...(parked && replaceParked && { reusableUploads: replaceParked.reuseUploads }),
      },
    })

    publishProcesses.set(item.seedLocalId, publishProcess)
    holdItemUntilStopped(item, publishProcess)
    const settledPublishes = new Map(context.settledPublishes)
    settledPublishes.delete(item.seedLocalId)
    settleCreatePublish(createToken, publishProcess)

    return {
      ...context,
      publishProcesses,
      settledPublishes,
    }
  })

  enqueue.assign(({ context, spawn }) => {
    const { subscriptions, publishProcesses } = context
    const publishProcess = publishProcesses.get(item.seedLocalId)
    if (!publishProcess) {
      console.warn(`Publish process with seedLocalId "${item.seedLocalId}" does not exist.`)
      return context
    }

    if (subscriptions.has(item.seedLocalId)) {
      console.warn(`Subscription with seedLocalId "${item.seedLocalId}" already exists.`)
      return context
    }

    const subscriptionProcess = spawn(subscribe, {
      input: { publishProcess, seedLocalId: item.seedLocalId },
    })

    subscriptions.set(item.seedLocalId, subscriptionProcess)

    return {
      ...context,
      subscriptions: new Map(subscriptions),
    }
  })
})

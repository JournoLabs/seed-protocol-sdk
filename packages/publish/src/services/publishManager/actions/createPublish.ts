import type { Item } from '@seedprotocol/sdk'
import type { Account } from 'thirdweb/wallets'
import { enqueueActions } from 'xstate'
import { getPublishConfig } from '~/config'
import { publishMachine } from '../../publish'
import { subscribe } from '../actors/subscribe'

export const createPublish = enqueueActions(({ event, enqueue }) => {
  const ev = event as unknown as {
    item: Item<any>
    address?: string
    account?: unknown
    options?: import('~/config').CreatePublishOptions
  }
  const { item, address, account, options } = ev

  const hasAddress = address != null && typeof address === 'string' && address.trim().length > 0
  if (!hasAddress) {
    console.warn('[createPublish] No valid wallet address; skipping spawn.')
    return
  }

  enqueue.assign(({ context, spawn }) => {
    const { publishProcesses } = context
    if (publishProcesses && publishProcesses.has(item.seedLocalId)) {
      console.warn(`Publish process with seedLocalId "${item.seedLocalId}" already exists.`)
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

    const publishProcess = spawn(publishMachine, {
      input: {
        item,
        address: address as string,
        account: account as Account | undefined,
        modelName: item.modelName,
        schemaId: item.schemaUid,
        signDataItems: options?.signDataItems,
        dataItemSigner: options?.dataItemSigner,
        signArweaveTransactions: options?.signArweaveTransactions,
        arweaveJwk: options?.arweaveJwk,
        publishMode: options?.publishMode ?? 'patch',
        publishRunId,
        arweaveUploadTags: arweaveUploadTags.length ? arweaveUploadTags : undefined,
      },
    })

    publishProcesses.set(item.seedLocalId, publishProcess)

    return {
      publishProcesses: new Map(publishProcesses),
    }
  })

  enqueue.assign(({ context, spawn }) => {
    const { subscriptions, publishProcesses } = context
    const publishProcess = publishProcesses.get(item.seedLocalId)
    if (!publishProcess) {
      console.warn(`Publish process with seedLocalId "${item.seedLocalId}" does not exist.`)
      return context
    }

    if (subscriptions && subscriptions.has(item.seedLocalId)) {
      console.warn(`Subscription with seedLocalId "${item.seedLocalId}" already exists.`)
      return context
    }

    const subscriptionProcess = spawn(subscribe, {
      input: { publishProcess, seedLocalId: item.seedLocalId },
    })

    subscriptions.set(item.seedLocalId, subscriptionProcess)

    return {
      subscriptions: new Map(subscriptions),
    }
  })
})

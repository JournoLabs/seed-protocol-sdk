import type { Item } from '@seedprotocol/sdk'
import { enqueueActions } from 'xstate'
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
import { getPublishWallet } from '~/helpers/publishWalletRegistry'

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
        dataItemSigner: coerceDataItemSigner(options?.dataItemSigner),
        signArweaveTransactions: options?.signArweaveTransactions,
        arweaveJwk: options?.arweaveJwk,
        publishMode: options?.publishMode ?? 'patch',
        publishRunId,
        arweaveUploadTags: arweaveUploadTags.length ? arweaveUploadTags : undefined,
        htmlEmbeddedDataUriPolicy:
          options?.htmlEmbeddedDataUriPolicy ??
          publishCfg.htmlEmbeddedDataUriPolicy ??
          'materialize',
      },
    })

    publishProcesses.set(item.seedLocalId, publishProcess)

    return {
      ...context,
      publishProcesses,
    }
  })

  enqueue(({ context }) => {
    const process = context.publishProcesses?.get(item.seedLocalId)
    if (process) subscribe(process)
  })
})

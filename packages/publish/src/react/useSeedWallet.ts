import { useCallback, useEffect, useState } from 'react'
import type { Address, EIP1193Provider } from 'viem'
import {
  isPublishWallet,
  type PublishWallet,
  type SeedSigner,
  type SeedTxSender,
} from '../helpers/seedSigner'
import {
  clearPublishWallet,
  getPublishWallet,
  setPublishWallet,
  type PublishWalletSession,
} from '../helpers/publishWalletRegistry'
import { fromEip1193Provider } from '../helpers/adapters/eip1193'
import { getPublishConfig } from '../config'
import { createPermissionlessTxSender } from '../helpers/adapters/permissionlessTxSender'
import { resolvePublishPayment } from '../payment'

export type SeedWalletStatus = 'disconnected' | 'connecting' | 'connected'

export type UseSeedWalletResult = {
  address: Address | undefined
  signer: SeedSigner | undefined
  txSender: SeedTxSender | undefined
  status: SeedWalletStatus
  connect: (input: EIP1193Provider | PublishWallet) => Promise<PublishWallet>
  disconnect: () => void
}

/**
 * Headless wallet session for publish — no Thirdweb dependency.
 * Registers into {@link setPublishWallet} so createPublish / ensureWalletThenPublish work.
 */
export function useSeedWallet(): UseSeedWalletResult {
  const [session, setSession] = useState<PublishWalletSession | null>(() => getPublishWallet())
  const [status, setStatus] = useState<SeedWalletStatus>(() =>
    getPublishWallet() ? 'connected' : 'disconnected',
  )

  useEffect(() => {
    setSession(getPublishWallet())
  }, [])

  const connect = useCallback(async (input: EIP1193Provider | PublishWallet) => {
    setStatus('connecting')
    try {
      let wallet: PublishWallet
      if (isPublishWallet(input)) {
        wallet = input
      } else {
        wallet = await fromEip1193Provider(input)
      }

      const config = getPublishConfig()
      const payment = resolvePublishPayment(config)
      let txSender = wallet.txSender
      if (payment.sender === 'eip7702') {
        txSender = await createPermissionlessTxSender({
          signer: wallet.signer,
          bundlerUrl: config.bundlerUrl!,
          paymasterUrl: config.paymasterUrl,
          sponsored: payment.gas.payer === 'sponsored',
        })
      }

      const next: PublishWalletSession = {
        signer: wallet.signer,
        txSender,
        ownedAddresses: [wallet.signer.address, txSender.address],
        publisherAddress: wallet.signer.address,
      }
      await setPublishWallet(next)
      setSession(next)
      setStatus('connected')
      return next
    } catch (err) {
      setStatus('disconnected')
      throw err
    }
  }, [])

  const disconnect = useCallback(() => {
    void clearPublishWallet()
    setSession(null)
    setStatus('disconnected')
  }, [])

  return {
    address: session?.signer.address,
    signer: session?.signer,
    txSender: session?.txSender,
    status,
    connect,
    disconnect,
  }
}

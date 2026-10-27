import { describe, expect, test } from 'bun:test'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { ethers } from 'ethers'
import { setConfigRef } from '../config'
import { fromEthersWallet } from '../helpers/seedSigner'
import { getPublishWallet } from '../helpers/publishWalletRegistry'
import { useSeedWallet, type UseSeedWalletResult } from './useSeedWallet'

describe('useSeedWallet', () => {
  test("connect registers the wallet's kind with the session", async () => {
    setConfigRef({ uploadApiBaseUrl: 'http://127.0.0.1:9', rpcUrl: 'https://example.invalid/rpc' })
    let hook: UseSeedWalletResult | undefined
    const Probe = () => {
      hook = useSeedWallet()
      return null
    }
    renderToString(<Probe />)

    const wallet = fromEthersWallet(new ethers.Wallet(ethers.Wallet.createRandom().privateKey))
    expect(wallet.kind).toBe('eoa')
    // setPublishWallet registers the session at once, then waits for the Seed client, which this
    // test doesn't start: read the session instead of awaiting connect.
    void hook!.connect(wallet)
    await Promise.resolve()
    expect(getPublishWallet()?.signer).toBe(wallet.signer)
    expect(getPublishWallet()?.kind).toBe('eoa')
  })
})

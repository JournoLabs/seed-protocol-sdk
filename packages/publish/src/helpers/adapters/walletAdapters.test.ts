import { describe, expect, test } from 'bun:test'
import {
  createWalletClient,
  custom,
  recoverMessageAddress,
  recoverTypedDataAddress,
  toHex,
  type Address,
  type EIP1193Provider,
  type Hex,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { baseSepolia, optimismSepolia } from 'viem/chains'
import { fromViemWalletClient } from './viemWalletClient'
import { fromPrivyWallet, type PrivyEthereumWalletLike } from './privy'

const typedData = {
  domain: { name: 'Account', version: '1', chainId: optimismSepolia.id },
  types: { Ping: [{ name: 'n', type: 'uint256' }] },
  primaryType: 'Ping',
  message: { n: 1n },
} as const

const TARGET = '0x3333333333333333333333333333333333333333' as Address
const TX_HASH = `0x${'cd'.repeat(32)}` as Hex

/**
 * An injected wallet on `chainId` that holds a local key: answers the methods viem sends for a
 * JSON-RPC account and records each eth_sendTransaction.
 */
function injectedWallet(chainId: number) {
  const account = privateKeyToAccount(generatePrivateKey())
  const sent: Record<string, unknown>[] = []
  const provider = {
    request: async ({ method, params }: { method: string; params?: unknown[] }) => {
      switch (method) {
        case 'eth_chainId':
          return toHex(chainId)
        case 'eth_accounts':
        case 'eth_requestAccounts':
          return [account.address]
        case 'personal_sign': {
          const [data] = params as [Hex]
          return account.signMessage({ message: { raw: data } })
        }
        case 'eth_signTypedData_v4': {
          const [, json] = params as [Address, string]
          const { EIP712Domain: _domain, ...types } = JSON.parse(json).types
          const parsed = JSON.parse(json)
          return account.signTypedData({ ...parsed, types })
        }
        case 'eth_sendTransaction':
          sent.push((params as [Record<string, unknown>])[0])
          return TX_HASH
        default:
          throw new Error(`unexpected ${method}`)
      }
    },
  } as EIP1193Provider
  return { account, provider, sent }
}

describe('fromViemWalletClient', () => {
  test('signs messages and typed data as the client account', async () => {
    const { account, provider } = injectedWallet(optimismSepolia.id)
    const walletClient = createWalletClient({
      account: account.address,
      chain: optimismSepolia,
      transport: custom(provider),
    })
    const { signer, kind } = fromViemWalletClient(walletClient, { chain: optimismSepolia })
    expect(kind).toBe('eoa')
    expect(signer.address).toBe(account.address)

    const raw = toHex('data item')
    const messageSig = await signer.signMessage({ message: { raw } })
    expect(await recoverMessageAddress({ message: { raw }, signature: messageSig })).toBe(
      account.address,
    )
    const typedSig = await signer.signTypedData!(typedData)
    expect(await recoverTypedDataAddress({ ...typedData, signature: typedSig })).toBe(
      account.address,
    )
  })

  test('sends through the wallet on the publish chain', async () => {
    const { account, provider, sent } = injectedWallet(optimismSepolia.id)
    const walletClient = createWalletClient({ account: account.address, transport: custom(provider) })
    const { txSender } = fromViemWalletClient(walletClient, { chain: optimismSepolia })

    const result = await txSender.sendTransaction({ to: TARGET, data: '0x1234', gas: 50_000n })
    expect(result.transactionHash).toBe(TX_HASH)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      from: account.address,
      to: TARGET,
      data: '0x1234',
      gas: toHex(50_000n),
    })
  })

  test('refuses to send while the wallet is on another chain', async () => {
    const { account, provider, sent } = injectedWallet(baseSepolia.id)
    const walletClient = createWalletClient({ account: account.address, transport: custom(provider) })
    const { txSender } = fromViemWalletClient(walletClient, { chain: optimismSepolia })

    await expect(txSender.sendTransaction({ to: TARGET, data: '0x' })).rejects.toThrow(
      /current chain of the wallet/i,
    )
    expect(sent).toHaveLength(0)
  })

  test('takes kind for a smart-wallet connector', () => {
    const { account, provider } = injectedWallet(optimismSepolia.id)
    const walletClient = createWalletClient({ account: account.address, transport: custom(provider) })
    expect(fromViemWalletClient(walletClient, { chain: optimismSepolia, kind: 'smart' }).kind).toBe(
      'smart',
    )
  })

  test('a local account signs EIP-7702 authorizations and a browser wallet has none', async () => {
    const local = privateKeyToAccount(generatePrivateKey())
    const localClient = createWalletClient({ account: local, transport: custom(injectedWallet(1).provider) })
    const { signer } = fromViemWalletClient(localClient, { chain: optimismSepolia })
    const auth = await signer.signAuthorization!({ address: TARGET, chainId: 1, nonce: 2 })
    expect(auth).toMatchObject({ address: TARGET, chainId: 1, nonce: 2 })

    const { account, provider } = injectedWallet(optimismSepolia.id)
    const browserClient = createWalletClient({ account: account.address, transport: custom(provider) })
    expect(fromViemWalletClient(browserClient, { chain: optimismSepolia }).signer.signAuthorization).toBeUndefined()
  })

  test('throws for a client without an account', () => {
    const walletClient = createWalletClient({ transport: custom(injectedWallet(1).provider) })
    expect(() => fromViemWalletClient(walletClient)).toThrow(/needs a WalletClient with an account/)
  })
})

/** A Privy ConnectedWallet whose provider reports the chain it was switched to. */
function privyWallet(startChainId: number) {
  let chainId = startChainId
  const calls: string[] = []
  const inner = injectedWallet(startChainId)
  const wallet: PrivyEthereumWalletLike = {
    address: inner.account.address,
    get chainId() {
      return `eip155:${chainId}`
    },
    switchChain: async (id) => {
      calls.push(`switch:${Number(id)}`)
      chainId = Number(id)
    },
    getEthereumProvider: async () => {
      calls.push(`provider:${chainId}`)
      return injectedWallet(chainId).provider
    },
  }
  return { wallet, calls, sent: () => inner.sent }
}

describe('fromPrivyWallet', () => {
  test('switches to the publish chain before taking the provider', async () => {
    const { wallet, calls } = privyWallet(baseSepolia.id)
    const published = await fromPrivyWallet(wallet, { chain: optimismSepolia })

    expect(calls).toEqual([`switch:${optimismSepolia.id}`, `provider:${optimismSepolia.id}`])
    expect(published.signer.address).toBe(wallet.address as Address)
    expect(published.txSender.address).toBe(wallet.address as Address)
    expect(published.kind).toBe('eoa')
    await expect(
      published.txSender.sendTransaction({ to: TARGET, data: '0x' }),
    ).resolves.toEqual({ transactionHash: TX_HASH })
  })

  test('leaves a wallet already on the publish chain alone', async () => {
    const { wallet, calls } = privyWallet(optimismSepolia.id)
    await fromPrivyWallet(wallet, { chain: optimismSepolia })
    expect(calls).toEqual([`provider:${optimismSepolia.id}`])
  })
})

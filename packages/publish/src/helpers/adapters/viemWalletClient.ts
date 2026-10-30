import type { Account, Chain, Hex, Transport, WalletClient } from 'viem'
import {
  brandSigner,
  brandTxSender,
  type PublishWallet,
  type PublishWalletKind,
  type SeedAuthorizationRequest,
  type SeedSigner,
} from '../seedSigner'
import { getPublishViemChain } from '../chainConfig'

export type FromViemWalletClientOptions = {
  /** Chain transactions are sent on. Defaults to the publish chain. */
  chain?: Chain
  /**
   * What the client's account is. Defaults to `'eoa'`. Pass `'smart'` for a connector whose
   * account is a smart contract wallet (Coinbase Smart Wallet, Safe), since its signatures can't
   * sign data items and publish must not attest straight to EAS from it.
   */
  kind?: PublishWalletKind
  /**
   * Signs EIP-7702 authorizations, for the EIP-7702 sender's first UserOp from an EOA. A local
   * viem account does this itself. A browser wallet can't over JSON-RPC, so pass the wallet
   * vendor's own call here if it has one.
   */
  signAuthorization?: SeedSigner['signAuthorization']
}

/**
 * Build a PublishWallet from a viem `WalletClient` with an account: wagmi's `useWalletClient` /
 * `getWalletClient`, and the kits built on wagmi (RainbowKit, ConnectKit, Reown AppKit).
 * Transactions go through `walletClient.sendTransaction`, so the user pays gas. For a JSON-RPC
 * account viem refuses to send while the wallet is on another chain (`ChainMismatchError`);
 * switch the wallet first.
 */
export function fromViemWalletClient(
  walletClient: WalletClient<Transport, Chain | undefined, Account | undefined>,
  options: FromViemWalletClientOptions = {},
): PublishWallet {
  const account = walletClient.account
  if (!account) {
    throw new Error(
      '@seedprotocol/publish: fromViemWalletClient needs a WalletClient with an account (wagmi: useWalletClient() once connected)',
    )
  }
  const chain = options.chain ?? getPublishViemChain()
  const address = account.address
  const signAuthorization =
    options.signAuthorization ??
    (account.type === 'local' && account.signAuthorization
      ? ({ address: contractAddress, chainId, nonce }: SeedAuthorizationRequest) =>
          account.signAuthorization!({ address: contractAddress, chainId, nonce })
      : undefined)

  const signer = brandSigner({
    address,
    signMessage: async ({ message }) =>
      walletClient.signMessage({
        account,
        message: typeof message === 'string' ? message : { raw: message.raw as Hex | Uint8Array },
      }),
    signTypedData: async (args) =>
      walletClient.signTypedData({ ...args, account } as Parameters<
        typeof walletClient.signTypedData
      >[0]),
    ...(signAuthorization && { signAuthorization }),
  })

  const txSender = brandTxSender({
    address,
    sendTransaction: async (tx) => {
      const hash = await walletClient.sendTransaction({
        account,
        chain,
        to: tx.to,
        data: tx.data,
        value: tx.value,
        gas: tx.gas,
      })
      return { transactionHash: hash }
    },
  })

  return { signer, txSender, kind: options.kind ?? 'eoa' }
}

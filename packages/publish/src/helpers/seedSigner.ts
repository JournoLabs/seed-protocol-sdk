import { prepareTransaction, sendTransaction } from 'thirdweb'
import type { Account } from 'thirdweb/wallets'
import { optimismSepolia } from 'thirdweb/chains'
import type { Address, Hex, SignableMessage } from 'viem'
import { ethers } from 'ethers'

/** Encoded calldata ready for submission (viem path). */
export type SeedTxRequest = {
  to: Address
  data: Hex
  value?: bigint
  gas?: bigint
}

/**
 * Vendor-neutral signer for Arweave DataItems and on-chain sends.
 * Thirdweb Account remains the AA backend via {@link fromThirdwebAccount}.
 */
export interface SeedSigner {
  readonly address: Address

  /**
   * personal_sign. For Arweave/ANS-104 use `message: { raw: Hex | Uint8Array }`
   * (matches Thirdweb Account). Plain string is UTF-8 prefixed hash.
   */
  signMessage(args: { message: SignableMessage }): Promise<Hex>

  /**
   * Submit already-encoded calldata. Thirdweb adapter preserves EIP-4337 / EIP-7702 sponsorship.
   */
  sendTransaction(tx: SeedTxRequest): Promise<{ transactionHash: Hex }>
}

const SEED_SIGNER_BRAND = Symbol.for('seedprotocol.SeedSigner')

type BrandedSeedSigner = SeedSigner & { readonly [SEED_SIGNER_BRAND]: true }

function brand(signer: SeedSigner): SeedSigner {
  return Object.assign(signer, { [SEED_SIGNER_BRAND]: true as const }) as BrandedSeedSigner
}

export function isSeedSigner(value: unknown): value is SeedSigner {
  return !!value && typeof value === 'object' && SEED_SIGNER_BRAND in value
}

/**
 * Wrap a Thirdweb Account so AA gas sponsorship still flows through thirdweb `sendTransaction`.
 */
export function fromThirdwebAccount(account: Account): SeedSigner {
  return brand({
    address: account.address as Address,
    signMessage: async ({ message }) => {
      const sig = await account.signMessage({ message })
      return sig as Hex
    },
    sendTransaction: async (tx) => {
      // Lazy import avoids circular dependency with helpers/thirdweb.ts
      const { getClient } = await import('./thirdweb')
      const transaction = prepareTransaction({
        client: getClient(),
        chain: optimismSepolia,
        to: tx.to,
        data: tx.data,
        value: tx.value,
        gas: tx.gas,
      })
      const result = await sendTransaction({ account, transaction })
      return { transactionHash: result.transactionHash as Hex }
    },
  })
}

/**
 * Wrap an ethers Wallet for tests / EOA scripts.
 */
export function fromEthersWallet(wallet: ethers.Wallet): SeedSigner {
  return brand({
    address: wallet.address as Address,
    signMessage: async ({ message }) => {
      if (typeof message === 'string') {
        return (await wallet.signMessage(message)) as Hex
      }
      const raw = message.raw
      const bytes =
        typeof raw === 'string'
          ? ethers.getBytes(raw)
          : raw instanceof Uint8Array
            ? raw
            : new Uint8Array(raw)
      return (await wallet.signMessage(bytes)) as Hex
    },
    sendTransaction: async (tx) => {
      const result = await wallet.sendTransaction({
        to: tx.to,
        data: tx.data,
        value: tx.value,
        gasLimit: tx.gas,
      })
      return { transactionHash: result.hash as Hex }
    },
  })
}

/**
 * Coerce Thirdweb Account or SeedSigner. Thirdweb Accounts are wrapped; branded SeedSigners pass through.
 */
export function asSeedSigner(accountOrSigner: Account | SeedSigner): SeedSigner {
  if (isSeedSigner(accountOrSigner)) return accountOrSigner
  return fromThirdwebAccount(accountOrSigner)
}

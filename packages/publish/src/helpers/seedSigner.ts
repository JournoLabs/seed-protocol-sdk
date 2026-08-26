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
 * Vendor-neutral key custody for Arweave DataItems and message signing.
 * Does not submit on-chain transactions.
 */
export interface SeedSigner {
  readonly address: Address

  /**
   * personal_sign. For Arweave/ANS-104 use `message: { raw: Hex | Uint8Array }`.
   * Plain string is UTF-8 prefixed hash.
   */
  signMessage(args: { message: SignableMessage }): Promise<Hex>
}

/**
 * Vendor-neutral transaction submission (EOA, AA, sponsored, etc.).
 */
export interface SeedTxSender {
  readonly address: Address

  /** Submit already-encoded calldata. */
  sendTransaction(tx: SeedTxRequest): Promise<{ transactionHash: Hex }>

  waitForReceipt?(transactionHash: Hex): Promise<{ status: 'success' | 'reverted' }>
}

/** Bundle used by publish / revoke flows that need both signing and sending. */
export type PublishWallet = {
  signer: SeedSigner
  txSender: SeedTxSender
}

const SEED_SIGNER_BRAND = Symbol.for('seedprotocol.SeedSigner')
const SEED_TX_SENDER_BRAND = Symbol.for('seedprotocol.SeedTxSender')

type BrandedSeedSigner = SeedSigner & { readonly [SEED_SIGNER_BRAND]: true }
type BrandedSeedTxSender = SeedTxSender & { readonly [SEED_TX_SENDER_BRAND]: true }

function brandSigner(signer: SeedSigner): SeedSigner {
  return Object.assign(signer, { [SEED_SIGNER_BRAND]: true as const }) as BrandedSeedSigner
}

function brandTxSender(sender: SeedTxSender): SeedTxSender {
  return Object.assign(sender, { [SEED_TX_SENDER_BRAND]: true as const }) as BrandedSeedTxSender
}

export function isSeedSigner(value: unknown): value is SeedSigner {
  return !!value && typeof value === 'object' && SEED_SIGNER_BRAND in value
}

export function isSeedTxSender(value: unknown): value is SeedTxSender {
  return !!value && typeof value === 'object' && SEED_TX_SENDER_BRAND in value
}

export function isPublishWallet(value: unknown): value is PublishWallet {
  return (
    !!value &&
    typeof value === 'object' &&
    'signer' in value &&
    'txSender' in value &&
    isSeedSigner((value as PublishWallet).signer) &&
    isSeedTxSender((value as PublishWallet).txSender)
  )
}

/**
 * Wrap an ethers Wallet for tests / EOA scripts (signs + sends; no AA sponsorship).
 */
export function fromEthersWallet(wallet: ethers.Wallet): PublishWallet {
  const address = wallet.address as Address
  const signer = brandSigner({
    address,
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
  })
  const txSender = brandTxSender({
    address,
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
  return { signer, txSender }
}

/**
 * Coerce a branded SeedSigner, PublishWallet.signer, or pass-through unknown branded value.
 * Does not wrap Thirdweb Accounts — use `fromThirdwebAccount` from `@seedprotocol/publish/thirdweb`.
 */
export function asSeedSigner(value: SeedSigner | PublishWallet): SeedSigner {
  if (isPublishWallet(value)) return value.signer
  if (isSeedSigner(value)) return value
  throw new Error(
    '@seedprotocol/publish: expected a SeedSigner or PublishWallet. Use fromEthersWallet, fromEip1193Provider, or fromThirdwebAccount.',
  )
}

/** Resolve tx sender from a PublishWallet or branded SeedTxSender. */
export function asSeedTxSender(value: SeedTxSender | PublishWallet): SeedTxSender {
  if (isPublishWallet(value)) return value.txSender
  if (isSeedTxSender(value)) return value
  throw new Error(
    '@seedprotocol/publish: expected a SeedTxSender or PublishWallet. Use fromEthersWallet, fromEip1193Provider, or fromThirdwebAccount.',
  )
}

/** Prefer PublishWallet; if only a branded SeedSigner is passed, throw (tx path needs a sender). */
export function asPublishWallet(value: PublishWallet | SeedSigner): PublishWallet {
  if (isPublishWallet(value)) return value
  throw new Error(
    '@seedprotocol/publish: expected a PublishWallet (signer + txSender). Use fromEthersWallet, fromEip1193Provider, or fromThirdwebAccount.',
  )
}

/** @internal used by optional Thirdweb adapter */
export { brandSigner, brandTxSender }

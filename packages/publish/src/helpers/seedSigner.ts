import type { Address, Hex, SignableMessage, SignedAuthorization, TypedData, TypedDataDefinition } from 'viem'
import { retryNonceTooLow } from './retryNonceTooLow'
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

  /**
   * EIP-712 signature (`eth_signTypedData_v4`). Optional: data item signing doesn't need it, but
   * ManagedAccount session-key grants and smart-account UserOps do (see {@link requireSignTypedData}).
   */
  signTypedData?<const T extends TypedData | Record<string, unknown>, P extends keyof T | 'EIP712Domain'>(
    args: TypedDataDefinition<T, P>,
  ): Promise<Hex>

  /**
   * EIP-7702 authorization delegating this EOA to `address`. Optional: only the EIP-7702 sender
   * needs it, once, on an EOA's first UserOp. Browser wallets don't expose this over EIP-1193.
   */
  signAuthorization?(args: SeedAuthorizationRequest): Promise<SignedAuthorization>
}

export type SeedAuthorizationRequest = {
  /** Contract to delegate to. */
  address: Address
  chainId: number
  /** The EOA's current transaction nonce. */
  nonce: number
}

/** `signer.signTypedData`, bound; throws when the signer doesn't implement it. */
export function requireSignTypedData(signer: SeedSigner): NonNullable<SeedSigner['signTypedData']> {
  if (typeof signer.signTypedData !== 'function') {
    throw new Error(
      `@seedprotocol/publish: signer ${signer.address} has no signTypedData, which ManagedAccount session keys and smart-account UserOps need. fromEthersWallet, fromEip1193Provider, fromViemWalletClient, fromPrivyWallet and fromThirdwebAccount provide it.`,
    )
  }
  return signer.signTypedData.bind(signer)
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
/**
 * What account a PublishWallet publishes from. `'eoa'`: a plain key, whose address is the signer
 * (publish may attest straight to EAS from it before it has any code). `'smart'`: a smart account
 * (ManagedAccount, thirdweb smart wallet), whose signatures can't sign data items. `'modular'`: an
 * admin EOA that publishes as the user's ManagedAccount, either sending as the account itself
 * (`createManagedAccountTxSender`) or as the thirdweb in-app EOA; its signer is an EOA, so it
 * signs data items. Unset: unknown, refused when choosing direct EAS.
 */
export type PublishWalletKind = 'eoa' | 'smart' | 'modular'

export type PublishWallet = {
  signer: SeedSigner
  txSender: SeedTxSender
  kind?: PublishWalletKind
}

/**
 * Whether `wallet` sends as `publisher`, an account its signer administers (for example a
 * ManagedAccount through `createManagedAccountTxSender`, with `kind: 'modular'`): the sender is the
 * publisher and the signer is a different address. Such a wallet publishes as it is, with no
 * Thirdweb in-app wallet setup.
 */
export function sendsAsManagedAccount(wallet: PublishWallet, publisher: string | undefined): boolean {
  if (!publisher || wallet.kind === 'eoa') return false
  const sender = wallet.txSender.address.toLowerCase()
  return sender === publisher.toLowerCase() && sender !== wallet.signer.address.toLowerCase()
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
 * Suitable for ANS-104 DataItem signing. Not a ManagedAccount session-key UserOp sender —
 * for automation on-chain publish, use a PublishWallet whose txSender submits UserOps
 * through the ManagedAccount (see docs/PUBLISH_AUTOMATION.md).
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
    signTypedData: async ({ domain, types, message }) => {
      // ethers derives EIP712Domain from `domain` and rejects it in `types`.
      const { EIP712Domain: _domainType, ...rest } = types as Record<string, ethers.TypedDataField[]>
      return (await wallet.signTypedData(
        (domain ?? {}) as ethers.TypedDataDomain,
        rest,
        message as Record<string, unknown>,
      )) as Hex
    },
    signAuthorization: async ({ address: delegate, chainId, nonce }) => {
      const { signature } = await wallet.authorize({ address: delegate, chainId, nonce })
      return {
        address: delegate,
        chainId,
        nonce,
        r: signature.r as Hex,
        s: signature.s as Hex,
        yParity: signature.yParity,
      }
    },
  })
  const txSender = brandTxSender({
    address,
    sendTransaction: async (tx) => {
      const result = await retryNonceTooLow(() =>
        wallet.sendTransaction({
          to: tx.to,
          data: tx.data,
          value: tx.value,
          gasLimit: tx.gas,
        }),
      )
      return { transactionHash: result.hash as Hex }
    },
  })
  return { signer, txSender, kind: 'eoa' }
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

import type { PublishConfig } from './config'

/**
 * Who pays a publish's EVM gas: `'sponsored'` (a Thirdweb or ERC-4337 paymaster) or `'user'`
 * (the publishing account's own ETH).
 */
export type PublishGasPayer = 'sponsored' | 'user'

/**
 * Who pays for Arweave storage: `'operator'` (the upload API at `uploadApiBaseUrl` funds it) or
 * `'user'` (see {@link PublishUserStorageConfig}).
 */
export type PublishStoragePayer = 'operator' | 'user'

/** Default Turbo endpoints (ArDrive). */
export const DEFAULT_TURBO_UPLOAD_URL = 'https://upload.ardrive.io'
export const DEFAULT_TURBO_PAYMENT_URL = 'https://payment.ardrive.io'

/**
 * How users pay for storage when `payment.storage` is `'user'`. The only provider so far is
 * Turbo: data items, signed by the user's EVM key as with operator-paid storage, go straight to the
 * Turbo upload service, which charges that address's Turbo credits (topped up with a card or
 * crypto through Turbo). Items under Turbo's free-tier size are free.
 */
export interface PublishUserStorageConfig {
  provider?: 'turbo'
  /** Turbo upload service. Default {@link DEFAULT_TURBO_UPLOAD_URL}. */
  uploadUrl?: string
  /** Turbo payment service (balances, prices). Default {@link DEFAULT_TURBO_PAYMENT_URL}. */
  paymentUrl?: string
  /**
   * Addresses whose shared Turbo credits pay first (Turbo's `x-paid-by`), e.g. an app wallet that
   * approved credits for its users. The signer's own credits cover the rest.
   */
  paidBy?: string[]
}

/**
 * Who pays for a publish. Each field is optional: leave it out to keep what the lower-level
 * settings (`thirdweb.sponsorGas`, `paymasterUrl`, ...) give. When set, it fills in those
 * settings' defaults, and `initPublish` throws if a setting contradicts it.
 */
export interface PublishPaymentConfig {
  gas?: PublishGasPayer
  storage?: PublishStoragePayer
  /** With `storage: 'user'`: the provider users pay. Defaults to Turbo. */
  userStorage?: PublishUserStorageConfig
}

/**
 * Which account sends a publish's transactions:
 * - `'modular'`: the user's Thirdweb managed account (`useModularExecutor`)
 * - `'eip7702'`: the permissionless EIP-7702 sender (`accountMode: 'eip7702'` with `bundlerUrl`)
 * - `'wallet'`: the registered publish wallet as-is (EIP-1193, ethers or a Thirdweb account)
 */
export type PublishSenderKind = 'modular' | 'eip7702' | 'wallet'

export interface ResolvedPublishPayment {
  sender: PublishSenderKind
  gas: {
    payer: PublishGasPayer
    /** Who sponsors when `payer` is `'sponsored'`. */
    sponsor?: 'thirdweb' | 'paymaster'
  }
  storage: {
    payer: PublishStoragePayer
    /** Always `'bundler'`: publish uploads signed data items. Kept for callers that pass it on. */
    path: 'bundler'
    /** Where uploads go: the upload API, or (user-paid) Turbo directly. */
    uploadTo: 'upload-api' | 'turbo'
    /** Set when `uploadTo` is `'turbo'`. */
    turbo?: { uploadUrl: string; paymentUrl: string; paidBy: string[] }
  }
}

export class PublishPaymentConfigError extends Error {
  constructor(message: string) {
    super(`@seedprotocol/publish: ${message}`)
    this.name = 'PublishPaymentConfigError'
  }
}

type PaymentInputs = Pick<
  PublishConfig,
  'payment' | 'useModularExecutor' | 'accountMode' | 'bundlerUrl' | 'paymasterUrl' | 'thirdweb' | 'useArweaveBundler'
>

/** The sender ensureWalletThenPublish and useSeedWallet use for this config. */
export function resolvePublishSender(config: PaymentInputs): PublishSenderKind {
  if (config.useModularExecutor) return 'modular'
  const accountMode = config.accountMode ?? (config.bundlerUrl ? 'eip7702' : 'eoa')
  if (accountMode === 'eip7702' && config.bundlerUrl) return 'eip7702'
  return 'wallet'
}

/**
 * `thirdweb.sponsorGas` with `payment.gas` as its default. Thirdweb wallets read this, so a
 * `payment: { gas: 'user' }` config builds unsponsored wallets without setting sponsorGas too.
 */
export function resolveSponsorGas(config: Pick<PublishConfig, 'payment' | 'thirdweb'>): boolean {
  const explicit = config.thirdweb?.sponsorGas
  if (explicit !== undefined) return explicit
  return config.payment?.gas !== 'user'
}

/**
 * Who pays gas and storage for this config, from the sender it selects. The publish flow and
 * {@link estimatePublishCost} both use this, so a cost estimate reports what a publish does.
 *
 * - modular: Thirdweb sponsors when `thirdweb.sponsorGas` (default true)
 * - eip7702: a paymaster sponsors (`paymasterUrl`, else the bundler), unless `payment.gas` is
 *   `'user'`, which sends without one
 * - wallet: the user pays
 *
 * Storage is uploaded as data items signed by the user's key. Operator-paid storage goes to the
 * upload API's bundler routes, which pay for them. User-paid storage goes to Turbo, charged to
 * the signer's credits.
 */
export function resolvePublishPayment(config: PaymentInputs): ResolvedPublishPayment {
  const sender = resolvePublishSender(config)
  let gas: ResolvedPublishPayment['gas']
  if (sender === 'modular') {
    gas = resolveSponsorGas(config) ? { payer: 'sponsored', sponsor: 'thirdweb' } : { payer: 'user' }
  } else if (sender === 'eip7702') {
    gas = config.payment?.gas === 'user' ? { payer: 'user' } : { payer: 'sponsored', sponsor: 'paymaster' }
  } else {
    gas = { payer: 'user' }
  }
  const storagePayer = config.payment?.storage ?? 'operator'
  if (storagePayer === 'user') {
    const userStorage = config.payment?.userStorage ?? {}
    return {
      sender,
      gas,
      storage: {
        payer: 'user',
        path: 'bundler',
        uploadTo: 'turbo',
        turbo: {
          uploadUrl: (userStorage.uploadUrl ?? DEFAULT_TURBO_UPLOAD_URL).replace(/\/$/, ''),
          paymentUrl: (userStorage.paymentUrl ?? DEFAULT_TURBO_PAYMENT_URL).replace(/\/$/, ''),
          paidBy: userStorage.paidBy ?? [],
        },
      },
    }
  }
  return {
    sender,
    gas,
    storage: {
      payer: 'operator',
      path: 'bundler',
      uploadTo: 'upload-api',
    },
  }
}

/**
 * Throws {@link PublishPaymentConfigError} when `payment` asks for something the other settings
 * can't deliver, or when `useArweaveBundler` is `false`. Called by `initPublish`.
 */
export function assertPublishPaymentConfig(config: PaymentInputs): void {
  if (config.useArweaveBundler === false) {
    throw new PublishPaymentConfigError(
      'useArweaveBundler: false is no longer supported. Publish uploads signed data items through ' +
        "the upload API's bundler routes (or Turbo with payment.storage: 'user'); remove the option.",
    )
  }
  const payment = config.payment
  if (!payment) return
  const sender = resolvePublishSender(config)

  if (payment.gas === 'sponsored') {
    if (sender === 'wallet') {
      throw new PublishPaymentConfigError(
        "payment.gas is 'sponsored', but publishes are sent from the connected wallet, which pays its own gas. " +
          'Set useModularExecutor (Thirdweb sponsorship) or bundlerUrl (EIP-7702 with a paymaster).',
      )
    }
    if (sender === 'modular' && config.thirdweb?.sponsorGas === false) {
      throw new PublishPaymentConfigError("payment.gas is 'sponsored' but thirdweb.sponsorGas is false.")
    }
  }

  if (payment.gas === 'user') {
    if (sender === 'modular' && config.thirdweb?.sponsorGas === true) {
      throw new PublishPaymentConfigError("payment.gas is 'user' but thirdweb.sponsorGas is true.")
    }
    if (sender === 'eip7702' && config.paymasterUrl) {
      throw new PublishPaymentConfigError(
        "payment.gas is 'user' but paymasterUrl is set; remove it so the EIP-7702 sender pays its own gas.",
      )
    }
  }

  if (payment.userStorage && payment.storage !== 'user') {
    throw new PublishPaymentConfigError("payment.userStorage is set but payment.storage is not 'user'.")
  }
}

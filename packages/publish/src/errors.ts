import type { UnrecordedAttestation } from './types'

export class AttestationVerificationError extends Error {
  constructor(
    message: string,
    public readonly seedLocalId: string,
    public readonly expectedSchemas: string[],
    public readonly foundSchemas: string[],
    public readonly code: 'METADATA_PROPERTIES_MISSING' = 'METADATA_PROPERTIES_MISSING',
  ) {
    super(message)
    this.name = 'AttestationVerificationError'
  }
}

export type ManagedAccountPublishErrorCode =
  | 'MANAGED_ACCOUNT_NOT_DEPLOYED'
  | 'MANAGED_ACCOUNT_UNAVAILABLE'
  | 'EXECUTOR_MODULE_NOT_INSTALLED'
  | 'MANAGED_ACCOUNT_SET_EAS_FAILED'
  | 'MODULAR_SIGNER_ACTIVATION_FAILED'
  | 'AUTOMATION_UNSUPPORTED_ACCOUNT'
  | 'AUTOMATION_PREFLIGHT_FAILED'
  | 'AUTOMATION_ACCOUNT_FUNDED'
  | 'PUBLISH_PREFLIGHT_FAILED'
  | 'PUBLISH_TOO_LARGE'
  | 'MULTI_PUBLISH_NOT_ROUTED'
  | 'USEROP_FAILED_NO_REASON'
  | 'USEROP_REVERTED'

/**
 * Best-effort string for RPC / thirdweb / viem failures that are not plain `Error`
 * (so logs and UIs can show the real revert or RPC reason).
 */
export function stringifyUnderlyingCause(u: unknown, maxLen = 700): string {
  if (u == null) return ''
  if (u instanceof Error) {
    const nested = u.cause instanceof Error ? ` | cause: ${u.cause.message}` : ''
    return (u.message + nested).slice(0, maxLen)
  }
  if (typeof u === 'object') {
    const o = u as Record<string, unknown>
    const parts: string[] = []
    if (typeof o.message === 'string') parts.push(o.message)
    if (typeof o.shortMessage === 'string') parts.push(o.shortMessage)
    if (typeof o.details === 'string') parts.push(o.details)
    if (typeof o.reason === 'string') parts.push(o.reason)
    if (parts.length) return parts.join(' | ').slice(0, maxLen)
    try {
      return JSON.stringify(u).slice(0, maxLen)
    } catch {
      return String(u).slice(0, maxLen)
    }
  }
  return String(u).slice(0, maxLen)
}

/**
 * Thrown or returned when the managed publishing account (on the publish chain) is missing,
 * unreachable, missing the executor module for the modular executor path, or EAS
 * pointer setup (`getEas` / `setEas`) fails, or modular session-signer activation fails.
 */
export class ManagedAccountPublishError extends Error {
  /** Original error when connection or deployment failed (avoids shadowing `Error.cause`). */
  public readonly underlyingCause?: unknown

  constructor(
    message: string,
    public readonly code: ManagedAccountPublishErrorCode,
    public readonly managedAddress?: string,
    underlyingCause?: unknown,
  ) {
    const extra =
      underlyingCause != null && underlyingCause !== ''
        ? ` (${stringifyUnderlyingCause(underlyingCause)})`
        : ''
    super(message + extra)
    this.name = 'ManagedAccountPublishError'
    this.underlyingCause = underlyingCause
  }
}

/**
 * EAS schemas a publish needs are missing and the account can't register them: an automation
 * session key may call only the executor module. The owner wallet registers them with
 * `ensureEasSchemasForModels` (or `ensureEasSchemasForItem`). Thrown before any transaction.
 */
export class EasSchemasNotRegisteredError extends Error {
  readonly code = 'EAS_SCHEMAS_NOT_REGISTERED' as const

  constructor(
    /** The missing schema definitions, e.g. `string word_count`. */
    public readonly missing: string[],
  ) {
    const list = missing.map((def) => `"${def}"`).join(', ')
    super(
      `${missing.length === 1 ? `schema ${list} is` : `schemas ${list} are`} not registered; automation keys can't register schemas. ` +
        'Call ensureEasSchemasForModels with the owner wallet first.',
    )
    this.name = 'EasSchemasNotRegisteredError'
  }
}

/** Thrown by `waitForPublishReceipt` when the transaction was mined but reverted. */
export class PublishTransactionRevertedError extends Error {
  constructor(
    public readonly transactionHash: string,
    /** The viem `TransactionReceipt`. */
    public readonly receipt: unknown,
  ) {
    super(`Transaction ${transactionHash} reverted.`)
    this.name = 'PublishTransactionRevertedError'
  }
}

/**
 * Thrown when a `multiPublish` landed and recording it locally failed. Nothing was recorded. A
 * retry records it from `unrecorded` and sends nothing.
 */
export class AttestationRecordError extends Error {
  constructor(
    public readonly unrecorded: UnrecordedAttestation,
    cause: unknown,
  ) {
    super(
      `Transaction ${unrecorded.transactionHash} attested this publish, but recording it failed: ` +
        `${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    )
    this.name = 'AttestationRecordError'
  }
}

/**
 * True when `e` is a managed-account publish error. Uses `name` + `code` as a fallback
 * when `instanceof` fails across duplicate bundled class identities.
 */
export function isManagedAccountPublishError(e: unknown): e is ManagedAccountPublishError {
  if (e instanceof ManagedAccountPublishError) return true
  if (typeof e !== 'object' || e === null) return false
  const o = e as { name?: string; code?: unknown }
  return o.name === 'ManagedAccountPublishError' && typeof o.code === 'string'
}

export type Eip7702ModularAccountPublishErrorCode =
  | 'EIP7702_MODULAR_ACCOUNT_UNAVAILABLE'
  | 'EIP7702_MODULAR_NOT_UPGRADED'
  | 'EIP7702_MODULAR_DEPLOY_FAILED'
  | 'EIP7702_MODULAR_NOT_CONFIRMED'

/**
 * Thrown when the in-app modular (EIP-7702) wallet is missing, not upgraded on-chain, or deploy/bootstrap failed.
 */
export class Eip7702ModularAccountPublishError extends Error {
  public readonly underlyingCause?: unknown

  constructor(
    message: string,
    public readonly code: Eip7702ModularAccountPublishErrorCode,
    public readonly modularAddress?: string,
    underlyingCause?: unknown,
  ) {
    const extra =
      underlyingCause != null && underlyingCause !== ''
        ? ` (${stringifyUnderlyingCause(underlyingCause)})`
        : ''
    super(message + extra)
    this.name = 'Eip7702ModularAccountPublishError'
    this.underlyingCause = underlyingCause
  }
}

const eip7702ModularCodes: Eip7702ModularAccountPublishErrorCode[] = [
  'EIP7702_MODULAR_ACCOUNT_UNAVAILABLE',
  'EIP7702_MODULAR_NOT_UPGRADED',
  'EIP7702_MODULAR_DEPLOY_FAILED',
  'EIP7702_MODULAR_NOT_CONFIRMED',
]

export function isEip7702ModularAccountPublishError(e: unknown): e is Eip7702ModularAccountPublishError {
  if (e instanceof Eip7702ModularAccountPublishError) return true
  if (typeof e !== 'object' || e === null) return false
  const o = e as { name?: string; code?: unknown }
  return (
    o.name === 'Eip7702ModularAccountPublishError' &&
    typeof o.code === 'string' &&
    (eip7702ModularCodes as string[]).includes(o.code)
  )
}

/**
 * True when the RPC/contract error indicates the account is **not** Thirdweb ModularCore
 * (no Router / `getInstalledModules`), e.g. default EIP-4337 smart accounts.
 * Includes viem "Cannot decode zero data" when `eth_call` returns `0x` for a missing Router view.
 */
export function isRouterNonModularCoreAccountError(cause: unknown): boolean {
  const msg = stringifyUnderlyingCause(cause)
  if (/Router:\s*function does not exist/i.test(msg)) return true
  if (/Cannot decode zero data\s*\(\s*["']0x["']\s*\)/i.test(msg)) return true
  return false
}

/**
 * A publish attested its properties, then failed to revoke the ones it retracts
 * (`clear({ retract: true })`). The new attestations are in place; the actor waits in
 * `retractionFailureRecoverable` for `PublishManager.retryAttestations(seedLocalId)`, which sends
 * only the revocation again.
 */
export class PublishRetractionError extends Error {
  readonly code = 'PUBLISH_RETRACTION_FAILED'
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'PublishRetractionError'
  }
}

function formatMiB(bytes: number): string {
  return `${(bytes / 2 ** 20).toFixed(1)} MiB`
}

/**
 * A publish's uploads add up to more than `maxUploadBytes` (PublishConfig or CreatePublishOptions,
 * default 100 MiB). Thrown in the checking step, before any file is read or anything is sent.
 */
export class UploadTooLargeError extends Error {
  readonly code = 'UPLOAD_TOO_LARGE'
  readonly uploadBytes: number
  readonly maxUploadBytes: number

  constructor(readonly estimate: import('./services/publishCost/uploadEstimate').UploadEstimate) {
    super(
      `This publish uploads ${formatMiB(estimate.uploadBytes)}, over the ${formatMiB(estimate.maxUploadBytes)} limit. ` +
        'Raise maxUploadBytes in the publish config or options to allow it.',
    )
    this.name = 'UploadTooLargeError'
    this.uploadBytes = estimate.uploadBytes
    this.maxUploadBytes = estimate.maxUploadBytes
  }
}

/**
 * A publish's uploads are over `confirmUploadAboveBytes` (default 25 MiB), or would use more than
 * a quarter of the device's memory, and the publish wasn't given `confirmUpload: true`. Show the
 * user `estimate` and publish again with `confirmUpload: true` if they agree.
 */
export class UploadNeedsConfirmError extends Error {
  readonly code = 'UPLOAD_NEEDS_CONFIRM'

  constructor(readonly estimate: import('./services/publishCost/uploadEstimate').UploadEstimate) {
    super(
      `This publish uploads ${formatMiB(estimate.uploadBytes)} (about ${estimate.uploadSeconds} s at ` +
        `${estimate.uplinkBitsPerSecond / 1e6} Mbit/s). Publish again with confirmUpload: true to go ahead.`,
    )
    this.name = 'UploadNeedsConfirmError'
  }
}

/**
 * A publish has no wallet: none on the run and none registered. Thrown in the checking step, before
 * anything is uploaded or sent. Connect one (useSeedWallet().connect, or setPublishWallet) and
 * publish again.
 */
export class PublishWalletMissingError extends Error {
  readonly code = 'PUBLISH_WALLET_MISSING'

  constructor() {
    super('No publish wallet is connected. Connect one (useSeedWallet().connect, or setPublishWallet) before publishing.')
    this.name = 'PublishWalletMissingError'
  }
}

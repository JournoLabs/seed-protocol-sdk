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
 * Thrown or returned when the managed publishing account (Optimism Sepolia) is missing,
 * unreachable, missing the executor module for the modular executor path, or EAS
 * pointer setup (`getEas` / `setEas`) fails.
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
 */
export function isRouterNonModularCoreAccountError(cause: unknown): boolean {
  return /Router:\s*function does not exist/i.test(stringifyUnderlyingCause(cause))
}

import { keccak256, toUtf8Bytes } from 'ethers'
import { approvedTargetsForAutomationPublish } from './approvedTargetsForAutomationPublish'

/** Fixed v1 scopes for publish automation grants. */
export const PUBLISH_AUTOMATION_SCOPES = 'publish,revoke' as const

export type AutomationSessionKeyPermissions = {
  approvedTargets: `0x${string}`[]
  nativeTokenLimitPerTransaction: number
  /** Unix seconds; omit for Thirdweb default long window. */
  expiresAt?: number
}

/**
 * Canonical permissions for an automation session key (module-only targets).
 */
export function buildAutomationSessionKeyPermissions(params?: {
  expiresAt?: number
}): AutomationSessionKeyPermissions {
  const approvedTargets = approvedTargetsForAutomationPublish()
  const out: AutomationSessionKeyPermissions = {
    approvedTargets,
    nativeTokenLimitPerTransaction: 0,
  }
  if (typeof params?.expiresAt === 'number' && params.expiresAt > 0) {
    out.expiresAt = Math.trunc(params.expiresAt)
  }
  return out
}

/**
 * Deterministic permissions hash for the PublishAuthorization sidecar.
 * Material: sorted targets | nativeLimit | expiresAt (0 if unset) | scopes
 */
export function hashAutomationSessionKeyPermissions(
  permissions: AutomationSessionKeyPermissions,
  scopes: string = PUBLISH_AUTOMATION_SCOPES,
): `0x${string}` {
  const targets = [...permissions.approvedTargets].map((a) => a.toLowerCase()).sort().join(',')
  const limit = permissions.nativeTokenLimitPerTransaction
  const expiresAt = permissions.expiresAt ?? 0
  const material = `${targets}|${limit}|${expiresAt}|${scopes.trim()}`
  return keccak256(toUtf8Bytes(material)) as `0x${string}`
}

/** Shape passed to Thirdweb `addSessionKey` / `shouldUpdateSessionKey`. */
export function toThirdwebSessionKeyPermissions(permissions: AutomationSessionKeyPermissions): {
  approvedTargets: `0x${string}`[]
  nativeTokenLimitPerTransaction: number
  permissionEndTimestamp?: Date
} {
  const base = {
    approvedTargets: permissions.approvedTargets,
    nativeTokenLimitPerTransaction: permissions.nativeTokenLimitPerTransaction,
  }
  if (permissions.expiresAt != null && permissions.expiresAt > 0) {
    return {
      ...base,
      permissionEndTimestamp: new Date(permissions.expiresAt * 1000),
    }
  }
  return base
}

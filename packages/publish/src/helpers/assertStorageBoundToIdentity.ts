import {
  assessPublishAuthorization,
  decodePublishAuthorizationData,
  getPublishAuthorizationFromEas,
} from '@seedprotocol/eas'
import { isAutomationSessionActive } from './ensureAutomationSessionKey'

export type AssertStorageBoundToIdentityParams = {
  managedAddress: string
  /** Recovered ANS-104 DataItem owner (Ethereum address). */
  dataItemOwner: string
  /**
   * Unix seconds for historical binding checks against PublishAuthorization expiry.
   * Defaults to now. Session-key live check always uses current `isActiveSigner`.
   */
  atTime?: number
  /**
   * When true (default), accept a live active session key on the ManagedAccount.
   */
  allowActiveSessionKey?: boolean
  /**
   * When true (default), accept a non-revoked PublishAuthorization sidecar valid at `atTime`.
   */
  allowSidecar?: boolean
}

export type AssertStorageBoundToIdentityResult = {
  bound: boolean
  via: 'active_session_key' | 'publish_authorization' | null
  warnings: string[]
}

/**
 * Whether an Arweave DataItem owner is bound to a ManagedAccount identity for authorship.
 * Prefer live `isActiveSigner` for current publishes; use the PublishAuthorization sidecar
 * for discoverability / historical grants (revoking the session key stops new binds via
 * active check; sidecar validity is assessed at `atTime`).
 */
export async function assertStorageBoundToIdentity(
  params: AssertStorageBoundToIdentityParams,
): Promise<AssertStorageBoundToIdentityResult> {
  const {
    managedAddress,
    dataItemOwner,
    atTime,
    allowActiveSessionKey = true,
    allowSidecar = true,
  } = params
  const warnings: string[] = []
  const owner = dataItemOwner.trim().toLowerCase()
  const identity = managedAddress.trim().toLowerCase()

  if (!/^0x[0-9a-fA-F]{40}$/.test(owner) || !/^0x[0-9a-fA-F]{40}$/.test(identity)) {
    return { bound: false, via: null, warnings: ['Invalid managedAddress or dataItemOwner'] }
  }

  if (allowActiveSessionKey) {
    try {
      const active = await isAutomationSessionActive(managedAddress, dataItemOwner)
      if (active) {
        return { bound: true, via: 'active_session_key', warnings }
      }
    } catch (e) {
      warnings.push(
        e instanceof Error ? e.message : 'isActiveSigner check failed',
      )
    }
  }

  if (allowSidecar) {
    try {
      const rows = await getPublishAuthorizationFromEas({
        identities: [managedAddress],
        sessionKeys: [dataItemOwner],
        excludeRevoked: true,
      })
      const nowMs = atTime != null ? atTime * 1000 : Date.now()
      for (const row of rows) {
        try {
          const decoded = decodePublishAuthorizationData(row.decodedDataJson ?? '[]')
          if (decoded.identity.toLowerCase() !== identity) continue
          if (decoded.sessionKey.toLowerCase() !== owner) continue
          const expirationTime =
            typeof row.expirationTime === 'number' ? row.expirationTime : null
          const assess = assessPublishAuthorization({
            decoded,
            expirationTime,
            now: nowMs,
          })
          if (assess.status === 'valid') {
            return {
              bound: true,
              via: 'publish_authorization',
              warnings: [...warnings, ...assess.warnings],
            }
          }
          warnings.push(...assess.warnings)
        } catch {
          // skip undecodable row
        }
      }
    } catch (e) {
      warnings.push(
        e instanceof Error ? e.message : 'PublishAuthorization query failed',
      )
    }
  }

  return { bound: false, via: null, warnings }
}

import { lookup, toRegistrableDomain } from 'rdapper'
import {
  hashDomainRegistryFingerprint,
  type DomainRegistryFingerprintInput,
} from '@seedprotocol/eas'

export type DomainRegistrySnapshot = DomainRegistryFingerprintInput & {
  expirationDate?: string
  updatedDate?: string
  registrarName?: string
  source?: string
  isRegistered?: boolean
}

/**
 * Normalize input to a registrable domain (eTLD+1). Throws when invalid.
 */
export function normalizeRegistrableDomain(input: string): string {
  const normalized = toRegistrableDomain(input)
  if (!normalized) {
    throw new Error(
      `@seedprotocol/publish: unable to resolve registrable domain for "${input}"`,
    )
  }
  return normalized.toLowerCase()
}

/**
 * Fetch RDAP/WHOIS registry snapshot and compute fingerprint inputs.
 */
export async function lookupDomainRegistry(
  domain: string,
): Promise<DomainRegistrySnapshot | null> {
  const registrable = normalizeRegistrableDomain(domain)
  const result = await lookup(registrable)
  if (!result.ok || !result.record) {
    return null
  }
  const record = result.record
  return {
    domain: registrable,
    creationDate: record.creationDate ?? '',
    registrarIanaId: record.registrar?.ianaId ?? '',
    expirationDate: record.expirationDate,
    updatedDate: record.updatedDate,
    registrarName: record.registrar?.name,
    source: record.source,
    isRegistered: record.isRegistered,
  }
}

export function fingerprintFromRegistrySnapshot(
  snapshot: DomainRegistryFingerprintInput,
): `0x${string}` {
  return hashDomainRegistryFingerprint({
    domain: snapshot.domain,
    creationDate: snapshot.creationDate ?? '',
    registrarIanaId: snapshot.registrarIanaId ?? '',
  })
}

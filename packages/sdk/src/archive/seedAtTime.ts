import {
  getItemPropertiesFromEas,
  getItemVersionsFromEas,
  getSeedsByUidsFromEas,
  type Attestation,
} from '@seedprotocol/eas'
import { pickLatestPropertyAttestationsByRefAndSchema } from '@/helpers/easPropertyCanonical'

/** What EAS held for a seed at one moment. */
export type SeedAtTime = {
  seed: Attestation
  /** The seed attester's Versions, oldest first, revoked ones included. */
  versions: Attestation[]
  /** The newest Version live at `asOf`; undefined when there was none. */
  version?: Attestation
  /** Unix seconds. The time given, else the last attestation or revocation on the Version. */
  asOf: number
  /**
   * The current attestation per property schema on `version` at `asOf`, by the rule sync uses:
   * the newest one live then, else the newest, whose `revoked` is then true (a retraction, ADR 0021).
   * `revoked` here means revoked by `asOf`.
   */
  properties: Attestation[]
  /** Every attestation on `version` from the Version's attester, at any time. */
  allProperties: Attestation[]
}

const sameAddress = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

const revokedBy = (attestation: Attestation, time: number): boolean =>
  attestation.revoked && attestation.revocationTime <= time

/** Reads `seedUid` from EAS as of `asOf` (unix seconds), default the latest state. Undefined: EAS has no such seed. */
export async function readSeedAtTime(seedUid: string, asOf?: number): Promise<SeedAtTime | undefined> {
  const [seed] = await getSeedsByUidsFromEas({ uids: [seedUid], excludeRevoked: false })
  if (!seed || seed.id.toLowerCase() !== seedUid.toLowerCase()) return undefined
  const versions = (await getItemVersionsFromEas({ seedUids: [seedUid], excludeRevoked: false }))
    .filter((v) => sameAddress(v.attester, seed.attester))
    .sort((a, b) => a.timeCreated - b.timeCreated || a.id.localeCompare(b.id))
  const time = asOf ?? Number.POSITIVE_INFINITY
  const version = versions.filter((v) => v.timeCreated <= time && !revokedBy(v, time)).at(-1)
  if (!version) return { seed, versions, asOf: asOf ?? seed.timeCreated, properties: [], allProperties: [] }

  // Anyone can attest with any refUID, so only the Version's attester counts.
  const allProperties = (await getItemPropertiesFromEas({ versionUids: [version.id], excludeRevoked: false })).filter(
    (p) => sameAddress(p.attester, version.attester),
  )
  const covered =
    asOf ??
    Math.max(version.timeCreated, ...allProperties.flatMap((p) => [p.timeCreated, p.revoked ? p.revocationTime : 0]))
  const properties = pickLatestPropertyAttestationsByRefAndSchema(
    allProperties.filter((p) => p.timeCreated <= covered).map((p) => ({ ...p, revoked: revokedBy(p, covered) })),
    { ifAllRevoked: 'newestRevoked' },
  )
  return { seed, versions, version, asOf: covered, properties, allProperties }
}
